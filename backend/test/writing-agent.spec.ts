import { Test, TestingModule } from '@nestjs/testing';
import { WritingScoringAgent } from '../src/agents/writing-scoring.agent';
import { AiService } from '../src/ai/ai.service';
import { ModelRouterService } from '../src/ai/model-router.service';
import { ToolRegistryService } from '../src/agents/tools/tool-registry.service';
import { PrismaService } from '../src/prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';

describe('WritingScoringAgent & Z.AI Infrastructure', () => {
  let agent: WritingScoringAgent;
  let modelRouter: ModelRouterService;
  let toolRegistry: ToolRegistryService;

  const mockPrisma = {
    agentRun: {
      create: jest.fn().mockResolvedValue({ id: 'mock-run-1' }),
      update: jest.fn().mockResolvedValue({ id: 'mock-run-1' }),
    },
    agentStep: {
      create: jest.fn().mockResolvedValue({ id: 'mock-step-1' }),
    },
    score: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 'mock-score-1', bandScore: 7.5 }),
    },
    attempt: {
      update: jest
        .fn()
        .mockResolvedValue({ id: 'mock-attempt-1', status: 'COMPLETED' }),
      findUnique: jest.fn().mockResolvedValue({
        id: 'mock-attempt-1',
        userId: 'student-123',
        testSet: { skill: 'WRITING' },
        answersJson: { text: 'Sample essay' },
      }),
    },
    reviewQueueItem: {
      upsert: jest.fn().mockResolvedValue({ id: 'rq-1', status: 'PENDING' }),
    },
  };

  const mockAiService = {
    executeStructuredTask: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingScoringAgent,
        ModelRouterService,
        ToolRegistryService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AiService, useValue: mockAiService },
      ],
    }).compile();

    agent = module.get<WritingScoringAgent>(WritingScoringAgent);
    modelRouter = module.get<ModelRouterService>(ModelRouterService);
    toolRegistry = module.get<ToolRegistryService>(ToolRegistryService);
  });

  describe('Model Router Strategy', () => {
    it('should route REASONING_EVAL to glm-4-plus', () => {
      const model = modelRouter.getModelForTask('REASONING_EVAL');
      expect(model).toBe('glm-4-plus');
    });

    it('should route COACH_ADVISOR to glm-4-air', () => {
      const model = modelRouter.getModelForTask('COACH_ADVISOR');
      expect(model).toBe('glm-4-air');
    });

    it('should route FAST_CLASSIFY to glm-4-flash', () => {
      const model = modelRouter.getModelForTask('FAST_CLASSIFY');
      expect(model).toBe('glm-4-flash');
    });

    it('should fallback from glm-4-plus to glm-4-air', () => {
      const fallback = modelRouter.getFallbackModel('glm-4-plus');
      expect(fallback).toBe('glm-4-air');
    });
  });

  describe('WritingScoringAgent Execution & Confidence Gate', () => {
    it('should auto-publish when confidence >= 0.85', async () => {
      mockAiService.executeStructuredTask.mockResolvedValueOnce({
        data: {
          taskAchievement: 7.5,
          coherenceCohesion: 7.0,
          lexicalResource: 7.5,
          grammaticalAccuracy: 7.0,
          overallBand: 7.5,
          confidence: 0.92,
          criterionFeedback: {
            taskAchievement: 'Clear position throughout',
            coherenceCohesion: 'Well-sequenced paragraphs',
            lexicalResource: 'Rich academic vocabulary',
            grammaticalAccuracy: 'Good syntactic control',
          },
          overallFeedback: 'Band 7.5 performance with strong task achievement.',
          inlineCorrections: [],
        },
        result: { totalTokens: 1250 },
      });

      const result = await agent.scoreEssay({
        attemptId: 'att-101',
        questionPrompt: 'Discuss both views and give your opinion.',
        taskType: 'TASK_2',
        studentEssay: 'This is a well-structured academic response...',
        userContext: { userId: 'student-123', role: 'STUDENT' },
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.scoreId).toBe('mock-score-1');
      expect(mockPrisma.score.create).toHaveBeenCalled();
    });

    it('should route to Review Queue when confidence < 0.85', async () => {
      mockAiService.executeStructuredTask.mockResolvedValueOnce({
        data: {
          taskAchievement: 6.5,
          coherenceCohesion: 6.0,
          lexicalResource: 7.0,
          grammaticalAccuracy: 6.5,
          overallBand: 6.5,
          confidence: 0.74, // Below threshold
          criterionFeedback: {
            taskAchievement: 'Borderline',
            coherenceCohesion: 'Unclear progression',
            lexicalResource: 'Adequate',
            grammaticalAccuracy: 'Frequent slips',
          },
          overallFeedback:
            'Needs examiner verification due to borderline cohesion.',
          inlineCorrections: [],
        },
        result: { totalTokens: 1180 },
      });

      const result = await agent.scoreEssay({
        attemptId: 'att-102',
        questionPrompt: 'Discuss both views.',
        taskType: 'TASK_2',
        studentEssay: 'Sample essay with edge-case rubric application.',
        userContext: { userId: 'student-123', role: 'STUDENT' },
      });

      expect(result.status).toBe('WAITING_FOR_APPROVAL');
      expect(result.scoreId).toBeNull();
      expect(mockPrisma.reviewQueueItem.upsert).toHaveBeenCalled();
    });
  });

  describe('Tool Registry Security & Permissions', () => {
    it('should prohibit student from accessing another candidate submission', async () => {
      await expect(
        toolRegistry.executeTool(
          'getAttemptSubmission',
          { attemptId: 'mock-attempt-1' },
          { userId: 'other-student-999', role: 'STUDENT' },
        ),
      ).rejects.toThrow(ForbiddenException);
    });

    it('should allow candidate to access their own submission', async () => {
      const sub = (await toolRegistry.executeTool(
        'getAttemptSubmission',
        { attemptId: 'mock-attempt-1' },
        { userId: 'student-123', role: 'STUDENT' },
      )) as { id: string };
      expect(sub.id).toBe('mock-attempt-1');
    });

    it('should calculate IELTS band score according to half-band rounding rules', async () => {
      // 6.25 average -> rounds up to 6.5
      const res1 = (await toolRegistry.executeTool(
        'calculateBandScore',
        { criteriaScores: [6.0, 6.5, 6.5, 6.0] },
        { userId: 'student-123', role: 'STUDENT' },
      )) as { bandScore: number };
      expect(res1.bandScore).toBe(6.5);

      // 6.125 average -> rounds down to 6.0
      const res2 = (await toolRegistry.executeTool(
        'calculateBandScore',
        { criteriaScores: [6.0, 6.0, 6.5, 6.0] },
        { userId: 'student-123', role: 'STUDENT' },
      )) as { bandScore: number };
      expect(res2.bandScore).toBe(6.0);
    });
  });
});
