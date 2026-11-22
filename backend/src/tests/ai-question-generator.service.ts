import {
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { z } from 'zod';
import { AiService } from '../ai/ai.service';

/**
 * QUESTION_GENERATION agent — writes brand-new IELTS practice questions with
 * Z.AI (GLM) so the platform's question pools stay ahead of its students.
 *
 * Every generated question is validated against the exam engine's exact
 * contract (options text == correctAnswer text; acceptedAnswers for
 * completions; partNumber/taskType conventions) before it may touch the
 * database. Invalid items are dropped, never repaired by hand.
 */

export type GeneratableSkill = 'LISTENING' | 'READING' | 'WRITING' | 'SPEAKING';

export interface GeneratedQuestion {
  questionType: 'MCQ' | 'COMPLETION' | 'ESSAY' | 'SPEAKING_PROMPT';
  partNumber: number;
  prompt: string;
  options: string[] | null;
  correctAnswer: string | null;
  acceptedAnswers: string[] | null;
  taskType: 'TASK_1' | 'TASK_2' | null;
}

export interface GeneratedSet {
  topic: string;
  /** Shared stimulus (transcript / reading passage). Attached to question 1. */
  passage: string | null;
  questions: GeneratedQuestion[];
}

const modelQuestionSchema = z.object({
  questionType: z.enum(['MCQ', 'COMPLETION', 'ESSAY', 'SPEAKING_PROMPT']),
  partNumber: z.number().int().min(1).max(4).optional(),
  prompt: z.string().min(5).max(2000),
  options: z.array(z.string().max(300)).max(6).optional().nullable(),
  correctAnswer: z.string().max(300).optional().nullable(),
  acceptedAnswers: z.array(z.string().max(200)).max(5).optional().nullable(),
  taskType: z.enum(['TASK_1', 'TASK_2']).optional().nullable(),
});

const modelOutputSchema = z.object({
  topic: z.string().min(2).max(80),
  passage: z.string().max(12_000).nullable().optional(),
  questions: z.array(modelQuestionSchema).min(1).max(20),
});

function skillBrief(skill: GeneratableSkill, count: number): string {
  switch (skill) {
    case 'LISTENING':
      return `Create one authentic IELTS Listening exercise (Section 2 or 3 register):
- "passage": a single natural conversational transcript (a monologue or dialogue, 280-420 words) on an everyday academic-or-community topic. Write speaker labels like "WOMAN:" / "MAN:" on new lines. Include concrete details (names, dates, prices, places, numbers) the questions can test.
- exactly ${count} MCQ questions that test the transcript in order (detail, purpose, gist, numbers). Each has exactly 4 options written as plain answer phrases WITHOUT letter prefixes, and "correctAnswer" must be one of the options VERBATIM.
- All questions must be answerable from the transcript alone.`;
    case 'READING':
      return `Create one authentic IELTS Academic Reading exercise:
- "passage": a single factual/analytical article (450-650 words) with an academic tone, structured in paragraphs, on a science, environment, history, technology or society topic.
- exactly ${count} questions mixing two types:
  * about 60% MCQ (exactly 4 plain-text options each, no letter prefixes; "correctAnswer" must equal one option VERBATIM) testing main idea, detail, inference or writer's claims;
  * about 40% COMPLETION (sentence completion: "prompt" contains the gapped sentence using "______" as the blank; "acceptedAnswers" lists 1-3 short acceptable answers, maximum 3 words each, all case variants allowed).
- All answers must be derivable from the passage.`;
    case 'WRITING':
      return `Create ${count} authentic IELTS Academic Writing prompts:
- NO shared passage: set "passage" to null.
- Each question is one prompt of type "ESSAY":
  * roughly half TASK_1 ("taskType": "TASK_1", partNumber 1): the "prompt" must begin with a visual-description sentence (e.g. "The chart below shows...") followed by a bracketed data summary such as "[DATA: line graph, 1990-2020, ...]" and end with "Summarise the information by selecting and reporting the main features, and make comparisons where relevant."
  * roughly half TASK_2 ("taskType": "TASK_2", partNumber 2): classic essay prompts ("To what extent do you agree or disagree?", "Discuss both views and give your own opinion.").
- "options" and "acceptedAnswers" must be omitted.`;
    case 'SPEAKING':
      return `Create ${count} authentic IELTS Speaking cue cards:
- NO shared passage: set "passage" to null.
- Each question: questionType "SPEAKING_PROMPT", partNumber 2, "prompt" formatted exactly like a real cue card:
  "Describe a ...
  You should say:
  - what it is
  - when it happened / who gave it to you
  - why it is important to you
  and explain how it affected you."
  Vary the topics widely (people, places, objects, events, experiences, media).
- "options" must be omitted.`;
  }
}

@Injectable()
export class AiQuestionGeneratorService {
  private readonly logger = new Logger(AiQuestionGeneratorService.name);

  constructor(private readonly aiService: AiService) {}

  async generate(params: {
    skill: GeneratableSkill;
    count: number;
    difficulty?: 'easy' | 'medium' | 'hard';
    topic?: string;
    excludeSamplePrompts: string[];
  }): Promise<GeneratedSet> {
    const excludeBlock =
      params.excludeSamplePrompts.length > 0
        ? `\n\nDo NOT repeat or closely paraphrase these existing question prompts:\n${params.excludeSamplePrompts
            .slice(0, 8)
            .map((p) => `- ${p.slice(0, 120)}`)
            .join('\n')}`
        : '';

    const difficultyLine = params.difficulty
      ? `\nTarget difficulty: ${params.difficulty}.`
      : '';
    const topicLine = params.topic
      ? `\nTopic focus: ${params.topic}.`
      : '\nChoose an engaging topic yourself and report it in "topic".';

    const { data } = await this.aiService
      .executeStructuredTask<z.infer<typeof modelOutputSchema>>({
        taskType: 'EXTRACTION',
        responseFormat: { type: 'json_object' },
        temperature: 0.7,
        // Short prompt + bounded output keeps one attempt inside Cloudflare's
        // 100 s edge timeout; the previous 6000-token/40-prompt version
        // retried past the E2E deadline.
        maxTokens: 4000,
        timeoutMs: 90_000,
        messages: [
          {
            role: 'system',
            content: `You are a senior IELTS content author producing exam-ready practice material. Your output MUST be strictly one JSON object matching:
{"topic": "<short topic name>", "passage": "<shared stimulus text or null>", "questions": [{"questionType": "MCQ|COMPLETION|ESSAY|SPEAKING_PROMPT", "partNumber": 1, "prompt": "...", "options": ["..."], "correctAnswer": "...", "acceptedAnswers": ["..."], "taskType": "TASK_1|TASK_2"}]}
Rules: correctAnswer must match one option verbatim; MCQ options have no letter prefixes; completion answers are <=3 words; every question is self-contained and answerable from the stimulus; write in flawless British-neutral academic English.${difficultyLine}`,
          },
          {
            role: 'user',
            content: `${skillBrief(params.skill, params.count)}${topicLine}${excludeBlock}`,
          },
        ],
        validator: (raw) => modelOutputSchema.parse(raw),
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        this.logger.error(`Question generation failed: ${message}`);
        throw new ServiceUnavailableException(
          'The AI question generator is temporarily unavailable. Try again shortly.',
        );
      });

    const valid = this.sanitize(params.skill, data);
    if (valid.length === 0) {
      throw new ServiceUnavailableException(
        'The AI generator produced no valid questions for this configuration. Adjust the request and retry.',
      );
    }
    return {
      topic: data.topic.trim().slice(0, 80),
      passage: data.passage?.trim() || null,
      questions: valid,
    };
  }

  /** Enforces the exam engine's per-type contract; drops anything invalid. */
  private sanitize(
    skill: GeneratableSkill,
    raw: z.infer<typeof modelOutputSchema>,
  ): GeneratedQuestion[] {
    const out: GeneratedQuestion[] = [];
    for (const q of raw.questions) {
      const prompt = q.prompt.trim();
      if (prompt.length < 5) continue;

      if (q.questionType === 'MCQ') {
        const options = (q.options ?? []).map((o) => o.trim()).filter(Boolean);
        const correct = (q.correctAnswer ?? '').trim();
        const match = options.find(
          (o) => o.toLowerCase() === correct.toLowerCase(),
        );
        if (options.length !== 4 || !match) {
          this.logger.warn(
            `Dropped invalid generated MCQ for ${skill}: ${prompt.slice(0, 60)}`,
          );
          continue;
        }
        out.push({
          questionType: 'MCQ',
          partNumber: q.partNumber ?? 1,
          prompt,
          options,
          correctAnswer: match,
          acceptedAnswers: null,
          taskType: null,
        });
        continue;
      }

      if (q.questionType === 'COMPLETION') {
        const accepted = (q.acceptedAnswers ?? [])
          .map((a) => a.trim())
          .filter(Boolean)
          .slice(0, 3);
        if (accepted.length === 0 || !prompt.includes('______')) continue;
        out.push({
          questionType: 'COMPLETION',
          partNumber: q.partNumber ?? 1,
          prompt,
          options: null,
          correctAnswer: accepted[0],
          acceptedAnswers: accepted,
          taskType: null,
        });
        continue;
      }

      if (q.questionType === 'ESSAY') {
        out.push({
          questionType: 'ESSAY',
          partNumber: q.taskType === 'TASK_1' ? 1 : 2,
          prompt,
          options: null,
          correctAnswer: null,
          acceptedAnswers: null,
          taskType: q.taskType === 'TASK_1' ? 'TASK_1' : 'TASK_2',
        });
        continue;
      }

      if (q.questionType === 'SPEAKING_PROMPT') {
        out.push({
          questionType: 'SPEAKING_PROMPT',
          partNumber: q.partNumber ?? 2,
          prompt,
          options: null,
          correctAnswer: null,
          acceptedAnswers: null,
          taskType: null,
        });
      }
    }
    return out;
  }
}
