import { Test, TestingModule } from '@nestjs/testing';
import { WritingScoringAgent } from './writing-scoring.agent';
import { ModelRouterService } from '../ai/model-router.service';
import { ToolRegistryService } from './tools/tool-registry.service';
import { PrismaService } from '../prisma/prisma.service';
import { ForbiddenException } from '@nestjs/common';
import { runWritingScoringGraph } from './langgraph/writing-scoring.graph';

// The graph builds a real ChatOpenAI against Z.AI — it must never execute in
// unit tests (the previous suite exercised the real model path, failing CI
// without env vars and making network calls with them). Mocking keeps the
// suite hermetic; the graph itself is covered by its own focused tests.
jest.mock('./langgraph/writing-scoring.graph', () => ({
  runWritingScoringGraph: jest.fn(),
}));

const mockGraph = runWritingScoringGraph as jest.Mock;

function graphResult(confidence: number, gate: 'PUBLISH' | 'REVIEW') {
  return {
    score: {
      taskAchievement: 7.5,
      coherenceCohesion: 7.0,
      lexicalResource: 7.5,
      grammaticalAccuracy: 7.0,
      overallBand: 7.0,
      confidence,
      criterionFeedback: {
        taskAchievement: 'Clear position throughout',
        coherenceCohesion: 'Well-sequenced paragraphs',
        lexicalResource: 'Rich academic vocabulary',
        grammaticalAccuracy: 'Good syntactic control',
      },
      overallFeedback: 'Solid academic performance.',
      inlineCorrections: [],
    },
    gate,
    steps: [
      { name: 'loadSubmission', durationMs: 1, summary: 'ok' },
      { name: 'scoreEssay', durationMs: 2, summary: 'ok' },
    ],
  };
}

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
      upsert: jest
        .fn()
        .mockResolvedValue({ id: 'mock-score-1', bandScore: 7.0 }),
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
      findUnique: jest.fn().mockResolvedValue(null),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      create: jest.fn().mockResolvedValue({ id: 'rq-1', status: 'PENDING' }),
    },
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    mockPrisma.reviewQueueItem.findUnique.mockResolvedValue(null);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WritingScoringAgent,
        ModelRouterService,
        ToolRegistryService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    agent = module.get<WritingScoringAgent>(WritingScoringAgent);
    modelRouter = module.get<ModelRouterService>(ModelRouterService);
    toolRegistry = module.get<ToolRegistryService>(ToolRegistryService);
  });

  describe('Model Router Strategy', () => {
    // Expectations follow the env contract (ZAI_MODEL_*), not hardcoded model
    // names — the provider catalog changes, the routing behavior must not.
    const reasoning = process.env.ZAI_MODEL_REASONING || 'glm-5';
    const general = process.env.ZAI_MODEL_GENERAL || 'glm-4.5-air';
    const fast = process.env.ZAI_MODEL_FAST || 'glm-5.3-flash';

    it('should route REASONING_EVAL to the reasoning tier', () => {
      expect(modelRouter.getModelForTask('REASONING_EVAL')).toBe(reasoning);
    });

    it('should route COACH_ADVISOR to the general tier', () => {
      expect(modelRouter.getModelForTask('COACH_ADVISOR')).toBe(general);
    });

    it('should route FAST_CLASSIFY to the fast tier', () => {
      expect(modelRouter.getModelForTask('FAST_CLASSIFY')).toBe(fast);
    });

    it('should fall back from the reasoning tier to the general tier', () => {
      expect(modelRouter.getFallbackModel(reasoning)).toBe(general);
    });

    it('should fall back from other tiers to the fast tier', () => {
      expect(modelRouter.getFallbackModel(general)).toBe(fast);
    });
  });

  describe('WritingScoringAgent Execution & Confidence Gate', () => {
    it('should auto-publish when confidence >= 0.85', async () => {
      mockGraph.mockResolvedValueOnce(graphResult(0.92, 'PUBLISH'));

      const result = await agent.scoreEssay({
        attemptId: 'att-101',
        questionPrompt: 'Discuss both views and give your opinion.',
        taskType: 'TASK_2',
        studentEssay: 'This is a well-structured academic response...',
        userContext: { userId: 'user-123', role: 'USER' },
      });

      expect(result.status).toBe('COMPLETED');
      expect(result.scoreId).toBe('mock-score-1');
      expect(mockPrisma.score.upsert).toHaveBeenCalled();
      // Single pass still records an audit decision for the admin monitor.
      const createMock = mockPrisma.reviewQueueItem.create as jest.Mock<
        unknown,
        [{ data?: { status?: string } }]
      >;
      expect(createMock.mock.calls.length).toBeGreaterThan(0);
      const firstArg = createMock.mock.calls[0]?.[0];
      expect(firstArg?.data?.status).toBe('AI_APPROVED');
    });

    it('should run a second AI review pass when confidence < 0.85 and publish the combined result', async () => {
      mockGraph
        .mockResolvedValueOnce(graphResult(0.74, 'REVIEW'))
        .mockResolvedValueOnce(graphResult(0.92, 'PUBLISH'));

      const result = await agent.scoreEssay({
        attemptId: 'att-102',
        questionPrompt: 'Discuss both views.',
        taskType: 'TASK_2',
        studentEssay: 'Sample essay with edge-case rubric application.',
        userContext: { userId: 'user-123', role: 'USER' },
      });

      // No human queue: the AI review agent converges and publishes.
      expect(result.status).toBe('COMPLETED');
      expect(result.scoreId).not.toBeNull();
      expect(mockPrisma.score.upsert).toHaveBeenCalled();
      // Audit trail entry is recorded for the admin monitor.
      expect(mockPrisma.reviewQueueItem.create).toHaveBeenCalled();
    });
  });

  describe('Tool Registry Security & Permissions', () => {
    it('should never rewrite an admin-overridden review decision', async () => {
      mockPrisma.reviewQueueItem.findUnique.mockResolvedValueOnce({
        id: 'rq-overridden',
        attemptId: 'att-102',
        status: 'OVERRIDDEN',
      });
      await toolRegistry.executeTool(
        'recordReviewDecision',
        {
          attemptId: 'att-102',
          skill: 'WRITING',
          proposedBand: 6.0,
          finalBand: 6.5,
          status: 'AI_APPROVED',
          notes: 'retry',
        },
        { userId: 'system', role: 'SYSTEM_ATTEMPT' },
      );
      expect(mockPrisma.reviewQueueItem.updateMany).not.toHaveBeenCalled();
      expect(mockPrisma.reviewQueueItem.create).not.toHaveBeenCalled();
    });

    it('should prohibit a user from accessing another candidate submission', async () => {
      await expect(
        toolRegistry.executeTool(
          'getAttemptSubmission',
          { attemptId: 'mock-attempt-1' },
          { userId: 'other-user-999', role: 'USER' },
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

    it('should reject empty criteriaScores instead of producing NaN', () => {
      // executeTool invokes sync tool bodies synchronously — a bad argument
      // surfaces as a synchronous throw rather than a rejected promise.
      expect(() =>
        toolRegistry.executeTool(
          'calculateBandScore',
          { criteriaScores: [] },
          { userId: 'student-123', role: 'STUDENT' },
        ),
      ).toThrow();
    });
  });
});
