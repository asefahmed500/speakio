import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { clampToBand } from '../../common/band.utils';
import { invokeWithBackoff } from '../../common/free-tier-backoff';

/**
 * Speaking Scoring Agent — LangGraph pipeline powered by Z.AI (GLM).
 *
 *   loadTranscript → scoreSpeaking → validateAndClamp → confidenceGate → END
 *
 * The transcript is produced upstream by GLM-ASR (real audio → text). Scoring
 * follows the official IELTS Speaking Band Descriptors. Pronunciation is
 * honestly framed as an estimate derived from the transcript (ASR artefacts
 * and fluency markers), never as a phonetic analysis.
 */

export interface SpeakingGraphInput {
  cueCardPrompt: string;
  transcript: string;
  audioDurationSeconds: number;
}

// A type alias (not an interface) so the object is structurally assignable to
// Prisma's InputJsonValue without casts when persisted.
export type SpeakingScore = {
  fluencyCoherence: number;
  lexicalResource: number;
  grammaticalAccuracy: number;
  pronunciation: number;
  overallBand: number;
  confidence: number;
  criterionFeedback: {
    fluencyCoherence: string;
    lexicalResource: string;
    grammaticalAccuracy: string;
    pronunciation: string;
  };
  overallFeedback: string;
};

export interface SpeakingGraphOutput {
  score: SpeakingScore;
  gate: 'PUBLISH' | 'REVIEW';
  tokenUsage: { input: number; output: number; total: number } | null;
}

const GraphState = Annotation.Root({
  cueCardPrompt: Annotation<string>,
  transcript: Annotation<string>,
  audioDurationSeconds: Annotation<number>,
  wordCount: Annotation<number>,
  rawScore: Annotation<SpeakingScore | null>,
  gate: Annotation<'PUBLISH' | 'REVIEW' | null>,
  tokenUsage: Annotation<{
    input: number;
    output: number;
    total: number;
  } | null>,
  error: Annotation<string | null>,
});

const ScoreSchema = z.object({
  fluencyCoherence: z.number().min(0).max(9),
  lexicalResource: z.number().min(0).max(9),
  grammaticalAccuracy: z.number().min(0).max(9),
  pronunciation: z.number().min(0).max(9),
  confidence: z.number().min(0).max(1),
  criterionFeedback: z.object({
    fluencyCoherence: z.string(),
    lexicalResource: z.string(),
    grammaticalAccuracy: z.string(),
    pronunciation: z.string(),
  }),
  overallFeedback: z.string(),
});

const SYSTEM_PROMPT = `You are a certified IELTS Speaking Examiner. Evaluate the candidate's recorded response using the official IELTS Speaking Band Descriptors (0 to 9 in half-band increments).

You receive an accurate ASR transcript of the candidate's speech (plus the cue card). Assess 4 criteria:
1. Fluency and Coherence — length, hesitation markers, connectives, relevance to the cue card
2. Lexical Resource — range and precision of vocabulary, collocations, idiomatic language
3. Grammatical Range and Accuracy — variety of structures, error frequency
4. Pronunciation — ESTIMATE ONLY: judge from the transcript using word-choice clarity, ASR recognition quality, sentence stress visible in punctuation, and speech rate (words per second of audio). Explicitly frame this as an estimate in the feedback.

Scoring anchors: a Part 2 long turn under 60 seconds of speech with short simple sentences typically cannot exceed Band 6.0 fluency. Very short or off-topic responses must score 4.0 or below.

Rules:
- All feedback MUST be polished, correctly spelled English; 2-3 sentences per criterion, quoting the candidate's exact words where relevant.
- Confidence is your certainty in applying the rubric (0.00-1.00). Borderline, very short, or ambiguous transcripts must score below 0.85.

Response format (mandatory): your ENTIRE response must be exactly one JSON object, no markdown fences, no prose:
{
  "fluencyCoherence": <number 0-9>,
  "lexicalResource": <number 0-9>,
  "grammaticalAccuracy": <number 0-9>,
  "pronunciation": <number 0-9>,
  "confidence": <number 0.00-1.00>,
  "criterionFeedback": { "fluencyCoherence": "<string>", "lexicalResource": "<string>", "grammaticalAccuracy": "<string>", "pronunciation": "<string>" },
  "overallFeedback": "<string>"
}`;

function buildModel() {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) throw new Error('ZAI_API_KEY is not configured');
  return new ChatOpenAI({
    apiKey,
    temperature: 0.1,
    modelName: process.env.ZAI_MODEL_REASONING ?? '@cf/zai-org/glm-4.7-flash',
    configuration: {
      baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
    },
    timeout: 90_000,
    maxRetries: 2,
  });
}

function extractJsonObject(text: string): unknown {
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1 || end <= start) {
    throw new Error('No JSON object found in model output');
  }
  return JSON.parse(t.slice(start, end + 1));
}

function extractTokenUsage(completion: unknown): {
  input: number;
  output: number;
  total: number;
} | null {
  const msg = completion as {
    usage_metadata?: {
      input_tokens?: number;
      output_tokens?: number;
      total_tokens?: number;
    };
    additional_kwargs?: { usage?: { total_tokens?: number } };
  };
  if (
    msg?.usage_metadata &&
    typeof msg.usage_metadata.total_tokens === 'number'
  ) {
    return {
      input: msg.usage_metadata.input_tokens ?? 0,
      output: msg.usage_metadata.output_tokens ?? 0,
      total: msg.usage_metadata.total_tokens,
    };
  }
  const u = msg?.additional_kwargs?.usage;
  if (u && typeof u.total_tokens === 'number') {
    return { input: 0, output: 0, total: u.total_tokens };
  }
  return null;
}

function compileGraph() {
  const model = buildModel();

  const loadTranscript = (state: typeof GraphState.State) => {
    const wordCount = state.transcript
      .trim()
      .split(/\s+/)
      .filter(Boolean).length;
    if (wordCount < 10) {
      return {
        error:
          'Recording transcript is too short to score — the response may be inaudible or empty',
      };
    }
    return { wordCount };
  };

  const scoreSpeaking = async (state: typeof GraphState.State) => {
    if (state.error) return {};
    const userMessage = `CUE CARD:\n${state.cueCardPrompt}\n\nAUDIO DURATION: ${Math.round(state.audioDurationSeconds)} seconds\n\nASR TRANSCRIPT:\n${state.transcript}`;
    const completion = await invokeWithBackoff(() =>
      model.invoke([
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userMessage },
      ]),
    );
    const rawText =
      typeof completion.content === 'string'
        ? completion.content
        : JSON.stringify(completion.content);
    const validated = ScoreSchema.parse(extractJsonObject(rawText));
    const score: SpeakingScore = {
      ...validated,
      overallBand: clampToBand(
        (validated.fluencyCoherence +
          validated.lexicalResource +
          validated.grammaticalAccuracy +
          validated.pronunciation) /
          4,
      ),
    };
    return {
      rawScore: score,
      tokenUsage: extractTokenUsage(completion),
    };
  };

  const validateAndClamp = (state: typeof GraphState.State) => {
    if (state.error || !state.rawScore) return {};
    const s = state.rawScore;
    const f = clampToBand(s.fluencyCoherence);
    const l = clampToBand(s.lexicalResource);
    const g = clampToBand(s.grammaticalAccuracy);
    const p = clampToBand(s.pronunciation);
    return {
      rawScore: {
        ...s,
        fluencyCoherence: f,
        lexicalResource: l,
        grammaticalAccuracy: g,
        pronunciation: p,
        overallBand: clampToBand((f + l + g + p) / 4),
        confidence: Math.min(1, Math.max(0, s.confidence)),
      },
    };
  };

  const confidenceGate = (state: typeof GraphState.State) => {
    if (state.error || !state.rawScore) return { gate: null };
    const gate: 'PUBLISH' | 'REVIEW' =
      state.rawScore.confidence >= 0.85 ? 'PUBLISH' : 'REVIEW';
    return { gate };
  };

  const routeAfterGate = (state: typeof GraphState.State) => {
    if (state.error) return END;
    return state.gate ? END : 'validateAndClamp';
  };

  const workflow = new StateGraph(GraphState)
    .addNode('loadTranscript', loadTranscript)
    .addNode('scoreSpeaking', scoreSpeaking)
    .addNode('validateAndClamp', validateAndClamp)
    .addNode('confidenceGate', confidenceGate)
    .addEdge('__start__', 'loadTranscript')
    .addEdge('loadTranscript', 'scoreSpeaking')
    .addEdge('scoreSpeaking', 'validateAndClamp')
    .addEdge('validateAndClamp', 'confidenceGate')
    .addConditionalEdges('confidenceGate', routeAfterGate);

  return workflow.compile();
}

export async function runSpeakingScoringGraph(
  input: SpeakingGraphInput,
): Promise<SpeakingGraphOutput> {
  const graph = compileGraph();
  const final = await graph.invoke({
    ...input,
    wordCount: 0,
    rawScore: null,
    gate: null,
    tokenUsage: null,
    error: null,
  });
  if (final.error || !final.rawScore) {
    throw new Error(final.error ?? 'Speaking scoring graph produced no result');
  }
  return {
    score: final.rawScore,
    gate: final.gate as 'PUBLISH' | 'REVIEW',
    tokenUsage: final.tokenUsage,
  };
}
