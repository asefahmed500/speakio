import { StateGraph, Annotation, END } from '@langchain/langgraph';
import { ChatOpenAI } from '@langchain/openai';
import { z } from 'zod';
import { clampToBand } from '../../common/band.utils';
import { invokeWithBackoff } from '../../common/free-tier-backoff';

/**
 * Writing Scoring Agent — LangGraph pipeline powered by Z.AI (GLM).
 *
 *   loadSubmission → scoreEssay → validateAndClamp → confidenceGate → END
 *
 * The gate is a decision, not a side effect: persistence stays in
 * WritingScoringAgent so the DB contract (AgentRun/AgentStep/Score) is unchanged.
 */

export interface GraphInput {
  taskType: 'TASK_1' | 'TASK_2';
  questionPrompt: string;
  essay: string;
}

export interface GraphStepLog {
  name: string;
  durationMs: number;
  summary: string;
}

export interface GraphOutput {
  score: WritingScore;
  gate: 'PUBLISH' | 'REVIEW';
  steps: GraphStepLog[];
  tokenUsage: { input: number; output: number; total: number } | null;
}

/** Best-effort token usage extraction across LangChain message shapes. */
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
    additional_kwargs?: {
      usage?: {
        prompt_tokens?: number;
        completion_tokens?: number;
        total_tokens?: number;
      };
    };
  };
  const um = msg?.usage_metadata;
  if (um && typeof um.total_tokens === 'number') {
    return {
      input: um.input_tokens ?? 0,
      output: um.output_tokens ?? 0,
      total: um.total_tokens,
    };
  }
  const u = msg?.additional_kwargs?.usage;
  if (u && typeof u.total_tokens === 'number') {
    return {
      input: u.prompt_tokens ?? 0,
      output: u.completion_tokens ?? 0,
      total: u.total_tokens,
    };
  }
  return null;
}

// A type alias (not an interface) so the object is structurally assignable to
// Prisma's InputJsonValue without casts when persisted.
export type WritingScore = {
  taskAchievement: number;
  coherenceCohesion: number;
  lexicalResource: number;
  grammaticalAccuracy: number;
  overallBand: number;
  confidence: number;
  criterionFeedback: {
    taskAchievement: string;
    coherenceCohesion: string;
    lexicalResource: string;
    grammaticalAccuracy: string;
  };
  overallFeedback: string;
  inlineCorrections: Array<{
    originalText: string;
    correctedText: string;
    explanation: string;
  }>;
};

const GraphState = Annotation.Root({
  taskType: Annotation<'TASK_1' | 'TASK_2'>,
  questionPrompt: Annotation<string>,
  essay: Annotation<string>,
  wordCount: Annotation<number>,
  rawScore: Annotation<WritingScore | null>,
  gate: Annotation<'PUBLISH' | 'REVIEW' | null>,
  steps: Annotation<GraphStepLog[]>,
  tokenUsage: Annotation<{
    input: number;
    output: number;
    total: number;
  } | null>,
  error: Annotation<string | null>,
});

const ScoreSchema = z.object({
  taskAchievement: z.number().min(0).max(9),
  coherenceCohesion: z.number().min(0).max(9),
  lexicalResource: z.number().min(0).max(9),
  grammaticalAccuracy: z.number().min(0).max(9),
  confidence: z.number().min(0).max(1),
  criterionFeedback: z.object({
    taskAchievement: z.string(),
    coherenceCohesion: z.string(),
    lexicalResource: z.string(),
    grammaticalAccuracy: z.string(),
  }),
  overallFeedback: z.string(),
  inlineCorrections: z
    .array(
      z.object({
        originalText: z.string(),
        correctedText: z.string(),
        explanation: z.string(),
      }),
    )
    .max(20),
});

const SYSTEM_PROMPT = `You are a certified IELTS Senior Examiner. Evaluate the essay strictly using the official IELTS Band Descriptors (0 to 9 in half-band increments).

Assess 4 criteria:
1. Task Achievement (Task 1) / Task Response (Task 2)
2. Coherence and Cohesion
3. Lexical Resource
4. Grammatical Range and Accuracy

Spelling rules (mandatory):
- Spelling accuracy is scored as part of Lexical Resource, per the official descriptors. Every misspelled word must lower Lexical Resource proportionally to its frequency and severity.
- List EVERY misspelled word in inlineCorrections with the exact original fragment, the corrected spelling, and an explanation that begins with "Spelling:".
- Do not invent errors; quote the student's text exactly as written.

Output rules (mandatory):
- All feedback MUST be polished, correctly spelled, grammatically clean English. Never include mistakes in your own output.
- Keep each criterionFeedback to 2-3 sentences, specific to this essay, quoting the student's exact words where relevant.

Confidence: your certainty in applying the rubric, 0.00-1.00. Borderline or ambiguous scripts must score below 0.85.

Response format (mandatory): your ENTIRE response must be exactly one JSON object, no markdown fences, no prose, matching this schema:
{
  "taskAchievement": <number 0-9>,
  "coherenceCohesion": <number 0-9>,
  "lexicalResource": <number 0-9>,
  "grammaticalAccuracy": <number 0-9>,
  "confidence": <number 0.00-1.00>,
  "criterionFeedback": {
    "taskAchievement": "<string>",
    "coherenceCohesion": "<string>",
    "lexicalResource": "<string>",
    "grammaticalAccuracy": "<string>"
  },
  "overallFeedback": "<string>",
  "inlineCorrections": [{ "originalText": "<string>", "correctedText": "<string>", "explanation": "<string>" }]
}`;

function buildModel() {
  const apiKey = process.env.ZAI_API_KEY;
  if (!apiKey) {
    throw new Error('ZAI_API_KEY is not configured');
  }
  return new ChatOpenAI({
    apiKey,
    temperature: 0.1,
    modelName: process.env.ZAI_MODEL_REASONING ?? 'glm-4.7-flash',
    configuration: {
      // Same default as ZaiProvider — one env contract for the same provider.
      baseURL: process.env.ZAI_BASE_URL || 'https://api.z.ai/api/paas/v4',
    },
    // A hung LLM call must never block the HTTP request indefinitely; without
    // these the attempt sits SCORING until the 5-minute staleness recovery.
    timeout: 90_000,
    maxRetries: 2,
  });
}

/**
 * Robust JSON extraction: Z.AI answers freeform despite the format contract —
 * it may wrap the object in markdown fences or lead with prose. Pull the
 * outermost JSON object out of whatever came back instead of trusting the
 * provider's function-calling (which GLM models do not honor reliably).
 */
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

function compileGraph() {
  // Plain completion model — structured output is enforced below via prompt
  // contract + JSON extraction + Zod validation, NOT via provider tool-calls.
  const model = buildModel();

  // Synchronous graph steps are intentionally not async — LangGraph accepts
  // both, and a promise wrapper would only obscure the pure logic.
  const loadSubmission = (state: typeof GraphState.State) => {
    const start = Date.now();
    const wordCount = state.essay.trim().split(/\s+/).filter(Boolean).length;
    if (wordCount < 5) {
      return {
        error: 'Essay is too short to score',
        steps: [
          ...state.steps,
          {
            name: 'loadSubmission',
            durationMs: Date.now() - start,
            summary: `Rejected: ${wordCount} words`,
          },
        ],
      };
    }
    return {
      wordCount,
      error: null,
      steps: [
        ...state.steps,
        {
          name: 'loadSubmission',
          durationMs: Date.now() - start,
          summary: `${state.taskType}, ${wordCount} words`,
        },
      ],
    };
  };

  const scoreEssay = async (state: typeof GraphState.State) => {
    const start = Date.now();
    if (state.error) return {};
    const userMessage = `TASK TYPE: ${state.taskType}\n\nPROMPT:\n${state.questionPrompt}\n\nSTUDENT ESSAY:\n${state.essay}`;

    // Bounded parse-retry: a malformed first response gets one corrective
    // nudge before the run fails. Mirrors AiService.executeStructuredTask.
    let lastError: Error | null = null;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const messages: Array<{ role: 'system' | 'user'; content: string }> = [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: userMessage },
        ];
        if (attempt > 0 && lastError) {
          messages.push({
            role: 'user',
            content: `Your previous response was not usable: ${lastError.message}. Respond again with exactly one JSON object matching the required schema and no other text.`,
          });
        }
        const completion = await invokeWithBackoff(() =>
          model.invoke(messages),
        );
        const rawText =
          typeof completion.content === 'string'
            ? completion.content
            : JSON.stringify(completion.content);
        const validated = ScoreSchema.parse(extractJsonObject(rawText));
        const usage = extractTokenUsage(completion);
        const score: WritingScore = {
          ...validated,
          overallBand: clampToBand(
            (validated.taskAchievement +
              validated.coherenceCohesion +
              validated.lexicalResource +
              validated.grammaticalAccuracy) /
              4,
          ),
          inlineCorrections: validated.inlineCorrections ?? [],
        };
        return {
          rawScore: score,
          tokenUsage: usage,
          steps: [
            ...state.steps,
            {
              name: 'scoreEssay',
              durationMs: Date.now() - start,
              summary: `TR ${score.taskAchievement} · CC ${score.coherenceCohesion} · LR ${score.lexicalResource} · GRA ${score.grammaticalAccuracy} · conf ${score.confidence.toFixed(2)}${attempt > 0 ? ' (after 1 retry)' : ''}`,
            },
          ],
        };
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
      }
    }
    throw new Error(
      `Scoring model did not return valid structured output: ${lastError?.message ?? 'unknown error'}`,
    );
  };

  const validateAndClamp = (state: typeof GraphState.State) => {
    const start = Date.now();
    if (state.error || !state.rawScore) return {};
    const s = state.rawScore;
    const clamped: WritingScore = {
      ...s,
      taskAchievement: clampToBand(s.taskAchievement),
      coherenceCohesion: clampToBand(s.coherenceCohesion),
      lexicalResource: clampToBand(s.lexicalResource),
      grammaticalAccuracy: clampToBand(s.grammaticalAccuracy),
      overallBand: clampToBand(
        (clampToBand(s.taskAchievement) +
          clampToBand(s.coherenceCohesion) +
          clampToBand(s.lexicalResource) +
          clampToBand(s.grammaticalAccuracy)) /
          4,
      ),
      confidence: Math.min(1, Math.max(0, s.confidence)),
    };
    return {
      rawScore: clamped,
      steps: [
        ...state.steps,
        {
          name: 'validateAndClamp',
          durationMs: Date.now() - start,
          summary: `overall ${clamped.overallBand}`,
        },
      ],
    };
  };

  const confidenceGate = (state: typeof GraphState.State) => {
    const start = Date.now();
    if (state.error || !state.rawScore)
      return { gate: null, steps: state.steps };
    const gate: 'PUBLISH' | 'REVIEW' =
      state.rawScore.confidence >= 0.85 ? 'PUBLISH' : 'REVIEW';
    return {
      gate,
      steps: [
        ...state.steps,
        {
          name: 'confidenceGate',
          durationMs: Date.now() - start,
          summary: gate,
        },
      ],
    };
  };

  const routeAfterGate = (state: typeof GraphState.State) => {
    if (state.error) return END;
    return state.gate === 'PUBLISH' || state.gate === 'REVIEW'
      ? END
      : 'validateAndClamp';
  };

  const workflow = new StateGraph(GraphState)
    .addNode('loadSubmission', loadSubmission)
    .addNode('scoreEssay', scoreEssay)
    .addNode('validateAndClamp', validateAndClamp)
    .addNode('confidenceGate', confidenceGate)
    .addEdge('__start__', 'loadSubmission')
    .addEdge('loadSubmission', 'scoreEssay')
    .addEdge('scoreEssay', 'validateAndClamp')
    .addEdge('validateAndClamp', 'confidenceGate')
    .addConditionalEdges('confidenceGate', routeAfterGate);

  return workflow.compile();
}

/** Runs the full scoring pipeline. Throws on model/config failure. */
export async function runWritingScoringGraph(
  input: GraphInput,
): Promise<GraphOutput> {
  const graph = compileGraph();
  const final = await graph.invoke({
    ...input,
    wordCount: 0,
    rawScore: null,
    gate: null,
    steps: [],
    tokenUsage: null,
    error: null,
  });
  if (final.error || !final.rawScore) {
    throw new Error(final.error ?? 'Scoring graph produced no result');
  }
  return {
    score: final.rawScore,
    gate: final.gate as 'PUBLISH' | 'REVIEW',
    steps: final.steps,
    tokenUsage: final.tokenUsage,
  };
}
