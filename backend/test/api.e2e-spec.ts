import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

/**
 * Full API integration suite against the real PostgreSQL database.
 * Covers: health, auth (incl. privilege-escalation guard), RBAC, test content
 * sanitization, the full attempt lifecycle with server-side auto-grading,
 * IDOR protection, idempotent submissions, vocabulary CRUD + ownership,
 * certificate verification, transactional review resolution and validation.
 * AI writing scoring is exercised separately (external dependency).
 */

const ts = Date.now();
const USER_A = { email: `qa-a-${ts}@speakio.test`, password: 'SuperSecure123!', name: 'QA User A' };
const USER_B = { email: `qa-b-${ts}@speakio.test`, password: 'SuperSecure123!', name: 'QA User B' };

jest.setTimeout(60_000);

describe('Speakio API (integration e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const cookieOf = (res: request.Response): string => {
    const setCookie = res.headers['set-cookie'];
    const raw = Array.isArray(setCookie) ? setCookie[0] : setCookie;
    return raw.split(';')[0];
  };

  const loginCache = new Map<string, Promise<string>>();

  const login = (email: string, password: string): Promise<string> => {
    // Memoize per-user: keeps the suite under the 10 logins/min route limit.
    if (!loginCache.has(email)) {
      loginCache.set(
        email,
        request(app.getHttpServer())
          .post('/auth/login')
          .send({ email, password })
          .then((res) => {
            if (res.status !== 200 && res.status !== 201) {
              throw new Error(`Login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
            }
            return cookieOf(res);
          }),
      );
    }
    return loginCache.get(email)!;
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    // Mirror main.ts middleware — the JwtAuthGuard reads req.cookies.
    app.use(cookieParser());
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    // Cleanup everything created by this run (cascades wipe attempts/scores/etc).
    await prisma.user.deleteMany({ where: { email: { endsWith: '@speakio.test' } } });
    await prisma.attempt.deleteMany({ where: { id: { startsWith: 'qa-attempt-' } } });
    await prisma.reviewQueueItem.deleteMany({ where: { id: { startsWith: 'qa-rq-' } } });
    await app.close();
  });

  it('GET / responds 200', async () => {
    await request(app.getHttpServer()).get('/').expect(200);
  });

  describe('Authentication', () => {
    it('registers a new user and always assigns STUDENT role (no self-declared privileges)', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ ...USER_A, role: 'SUPER_ADMIN' } as any)
        .expect(201);
      expect(res.body.role).toBe('STUDENT');
      expect(res.headers['set-cookie']).toBeDefined();
    });

    it('rejects duplicate registration with 409', async () => {
      await request(app.getHttpServer()).post('/auth/register').send(USER_A).expect(409);
    });

    it('rejects malformed registration payloads with 400', async () => {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: 'not-an-email', password: 'x', name: '' })
        .expect(400);
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email: USER_B.email, password: 'short', name: USER_B.name })
        .expect(400);
    });

    it('rejects wrong password with 401 and never reveals account existence', async () => {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: USER_A.email, password: 'WrongPassword1!' });
      expect(res.status).toBe(401);
      const res2 = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: 'ghost@speakio.test', password: 'Whatever1!' });
      expect(res2.status).toBe(401);
      expect(res.body.message).toBe(res2.body.message);
    });

    it('logs in and returns the session user', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send(USER_A).expect(200);
      expect(res.body.email).toBe(USER_A.email);
      expect(res.body.role).toBe('STUDENT');
    });

    it('returns profile for a valid session and 401 without/with invalid token', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      const me = await request(app.getHttpServer()).get('/auth/me').set('Cookie', cookie).expect(200);
      expect(me.body.email).toBe(USER_A.email);
      await request(app.getHttpServer()).get('/auth/me').expect(401);
      await request(app.getHttpServer())
        .get('/auth/me')
        .set('Cookie', 'access_token=forged.nonsense.token')
        .expect(401);
    });
  });

  describe('RBAC', () => {
    it('blocks anonymous access to protected endpoints', async () => {
      await request(app.getHttpServer()).get('/tests').expect(401);
      await request(app.getHttpServer()).get('/attempts').expect(401);
      await request(app.getHttpServer()).get('/dashboard/stats').expect(401);
    });

    it('forbids STUDENT from admin/instructor endpoints (server-side enforcement)', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      await request(app.getHttpServer()).get('/scoring/runs').set('Cookie', cookie).expect(403);
      await request(app.getHttpServer()).get('/scoring/review-queue').set('Cookie', cookie).expect(403);
    });

    it('allows INSTRUCTOR to access the review queue', async () => {
      const cookie = await login('examiner@speakio.com', 'password123');
      const res = await request(app.getHttpServer())
        .get('/scoring/review-queue')
        .set('Cookie', cookie)
        .expect(200);
      expect(Array.isArray(res.body)).toBe(true);
    });
  });

  describe('Test content', () => {
    it('lists seeded test sets with question counts', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      const res = await request(app.getHttpServer()).get('/tests').set('Cookie', cookie).expect(200);
      const skills = res.body.map((t: any) => t.skill);
      expect(skills).toContain('LISTENING');
      expect(skills).toContain('READING');
      expect(skills).toContain('WRITING');
      expect(skills).toContain('SPEAKING');
    });

    it('never leaks correct answers in test detail', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      const res = await request(app.getHttpServer())
        .get('/tests/listening-section1-uni-orientation')
        .set('Cookie', cookie)
        .expect(200);
      const serialized = JSON.stringify(res.body);
      expect(serialized).not.toContain('correctAnswer');
      expect(serialized).not.toContain('acceptedAnswers');
      expect(res.body.questions.length).toBe(10);
      expect(res.body.questions[0].options.length).toBeGreaterThan(0);
    });

    it('returns 404 for unknown test ids', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      await request(app.getHttpServer()).get('/tests/does-not-exist').set('Cookie', cookie).expect(404);
    });
  });

  describe('Attempt lifecycle — listening (auto-graded)', () => {
    let cookieA: string;
    let attemptId: string;

    it('starts a fresh attempt with server-side timer', async () => {
      cookieA = await login(USER_A.email, USER_A.password);
      const res = await request(app.getHttpServer())
        .post('/attempts')
        .set('Cookie', cookieA)
        .send({ testSetId: 'listening-section1-uni-orientation' })
        .expect(201);
      attemptId = res.body.id;
      expect(res.body.status).toBe('IN_PROGRESS');
      expect(res.body.timeRemainingSeconds).toBe(15 * 60);
    });

    it('resumes the existing in-progress attempt instead of duplicating', async () => {
      const res = await request(app.getHttpServer())
        .post('/attempts')
        .set('Cookie', cookieA)
        .send({ testSetId: 'listening-section1-uni-orientation' })
        .expect(201);
      expect(res.body.id).toBe(attemptId);
      expect(res.body.resumed).toBe(true);
    });

    it('autosaves answers and remaining time', async () => {
      await request(app.getHttpServer())
        .patch(`/attempts/${attemptId}`)
        .set('Cookie', cookieA)
        .send({ answers: { 'lis-s1-q1': '9:30 AM' }, timeRemainingSeconds: 600 })
        .expect(200);
      const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect((attempt.answersJson as any)['lis-s1-q1']).toBe('9:30 AM');
      expect(attempt.timeRemainingSeconds).toBe(600);
    });

    it('auto-grades the submission server-side and persists the score', async () => {
      const answers: Record<string, string> = {
        'lis-s1-q1': '9:30 AM', // correct
        'lis-s1-q2': 'Student Services Office', // correct
        'lis-s1-q3': 'Passport-sized photographs', // correct
        'lis-s1-q4': '£95', // wrong (correct: £150)
        'lis-s1-q5': 'orientation@uni.ac.uk', // correct
        'lis-s1-q6': 'Main Hall', // correct
        'lis-s1-q7': '15', // correct
        'lis-s1-q8': 'B', // correct
        'lis-s1-q9': 'photographs', // correct
        'lis-s1-q10': 'one day', // correct
      };
      const res = await request(app.getHttpServer())
        .post(`/attempts/${attemptId}/submit`)
        .set('Cookie', cookieA)
        .send({ answers, timeRemainingSeconds: 421 })
        .expect(201);
      expect(res.body.correctCount).toBe(9);
      expect(res.body.total).toBe(10);
      expect(res.body.bandScore).toBeGreaterThan(0);

      const score = await prisma.score.findUniqueOrThrow({
        where: { attemptId_skill: { attemptId, skill: 'LISTENING' } },
      });
      expect(score.scoredBy).toBe('AUTO_GRADER');
      expect(score.bandScore).toBe(res.body.bandScore);

      const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(attempt.status).toBe('COMPLETED');
    });

    it('rejects double submission (idempotency guard)', async () => {
      await request(app.getHttpServer())
        .post(`/attempts/${attemptId}/submit`)
        .set('Cookie', cookieA)
        .send({ answers: { 'lis-s1-q1': '9:30 AM' } })
        .expect(409);
    });

    it('serves the graded result with per-question review', async () => {
      const res = await request(app.getHttpServer())
        .get(`/attempts/${attemptId}`)
        .set('Cookie', cookieA)
        .expect(200);
      expect(res.body.status).toBe('COMPLETED');
      expect(res.body.score.bandScore).toBeGreaterThan(0);
      expect(res.body.score.scoredBy).toBe('AUTO_GRADER');
    });

    it('enforces ownership on result access (IDOR)', async () => {
      await request(app.getHttpServer()).post('/auth/register').send(USER_B).expect(201);
      const cookieB = await login(USER_B.email, USER_B.password);
      await request(app.getHttpServer()).get(`/attempts/${attemptId}`).set('Cookie', cookieB).expect(403);
      await request(app.getHttpServer())
        .patch(`/attempts/${attemptId}`)
        .set('Cookie', cookieB)
        .send({ answers: {} })
        .expect(403);
      await request(app.getHttpServer())
        .post(`/attempts/${attemptId}/submit`)
        .set('Cookie', cookieB)
        .send({ answers: {} })
        .expect(403);
    });
  });

  describe('Attempt lifecycle — speaking (human review routing)', () => {
    it('routes speaking submissions to the review queue without fabricating a band', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      const start = await request(app.getHttpServer())
        .post('/attempts')
        .set('Cookie', cookie)
        .send({ testSetId: 'speaking-part2-cuecard' })
        .expect(201);
      const audio = Buffer.from('fake-audio-payload-for-qa').toString('base64');
      const res = await request(app.getHttpServer())
        .post(`/attempts/${start.body.id}/submit`)
        .set('Cookie', cookie)
        .send({ answers: { 'spk-p2-q1': `data:audio/webm;base64,${audio}` } })
        .expect(201);
      expect(res.body.status).toBe('NEEDS_REVIEW');

      const item = await prisma.reviewQueueItem.findUniqueOrThrow({
        where: { attemptId: start.body.id },
      });
      expect(item.status).toBe('PENDING');
      expect(item.proposedBand).toBeNull();

      await prisma.reviewQueueItem.delete({ where: { id: item.id } }).catch(() => undefined);
      await prisma.attempt.delete({ where: { id: start.body.id } }).catch(() => undefined);
    });
  });

  describe('Vocabulary CRUD', () => {
    const item = {
      word: 'mitigate',
      partOfSpeech: 'verb',
      definition: 'To make something less severe or harmful.',
      bandTarget: 7.5,
      topic: 'Environment',
      collocations: ['mitigate risks'],
      synonyms: ['alleviate'],
      exampleSentence: 'Urban trees mitigate the heat island effect.',
    };

    it('creates, lists and deletes owned vocabulary items', async () => {
      const cookie = await login(USER_B.email, USER_B.password);
      const created = await request(app.getHttpServer())
        .post('/vocabulary')
        .set('Cookie', cookie)
        .send(item)
        .expect(201);
      expect(created.body.word).toBe('mitigate');

      const list = await request(app.getHttpServer()).get('/vocabulary').set('Cookie', cookie).expect(200);
      expect(list.body.some((i: any) => i.id === created.body.id)).toBe(true);

      await request(app.getHttpServer()).delete(`/vocabulary/${created.body.id}`).set('Cookie', cookie).expect(200);
      const after = await request(app.getHttpServer()).get('/vocabulary').set('Cookie', cookie).expect(200);
      expect(after.body.some((i: any) => i.id === created.body.id)).toBe(false);
    });

    it('rejects invalid payloads and cross-user deletes (IDOR)', async () => {
      const cookieB = await login(USER_B.email, USER_B.password);
      const cookieA = await login(USER_A.email, USER_A.password);

      await request(app.getHttpServer())
        .post('/vocabulary')
        .set('Cookie', cookieB)
        .send({ ...item, bandTarget: 9.7 })
        .expect(400);

      const created = await request(app.getHttpServer())
        .post('/vocabulary')
        .set('Cookie', cookieB)
        .send(item)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/vocabulary/${created.body.id}`)
        .set('Cookie', cookieA)
        .expect(403);

      await prisma.vocabularyItem.delete({ where: { id: created.body.id } });
    });
  });

  describe('Certificates', () => {
    it('publicly verifies the seeded certificate and 404s unknown codes', async () => {
      const res = await request(app.getHttpServer())
        .get('/certificates/verify/SPK-VERIFY-8891')
        .expect(200);
      expect(res.body.status).toBe('ACTIVE');
      expect(res.body.overallBand).toBe(8.0);
      expect(res.body.candidateName).toBe('Asef Ahmed');

      await request(app.getHttpServer()).get('/certificates/verify/UNKNOWN-CODE').expect(404);
    });

    it('refuses to issue a certificate before all four skills are complete', async () => {
      const cookie = await login(USER_B.email, USER_B.password);
      const res = await request(app.getHttpServer()).post('/certificates').set('Cookie', cookie);
      expect(res.status).toBe(400);
      expect(res.body.message).toContain('Missing');
    });

    it('rejects PDF download for certificates the user does not own (IDOR)', async () => {
      const cookieB = await login(USER_B.email, USER_B.password);
      const seeded = await prisma.certificate.findUniqueOrThrow({ where: { id: 'SPK-2026-8891-B80' } });
      await request(app.getHttpServer())
        .get(`/certificates/${seeded.id}/pdf`)
        .set('Cookie', cookieB)
        .expect(403);
    });
  });

  describe('Review queue resolution (transactional + idempotent)', () => {
    let attemptId: string;
    let itemId: string;
    let cookieExaminer: string;

    beforeAll(async () => {
      const userA = await prisma.user.findUniqueOrThrow({ where: { email: USER_A.email } });
      const attempt = await prisma.attempt.create({
        data: {
          id: `qa-attempt-${ts}`,
          userId: userA.id,
          testSetId: 'cambridge-18-test-1',
          status: 'NEEDS_REVIEW',
          answersJson: { 'c18-w-task2': 'q' },
        },
      });
      const item = await prisma.reviewQueueItem.create({
        data: {
          id: `qa-rq-${ts}`,
          attemptId: attempt.id,
          skill: 'WRITING',
          status: 'PENDING',
          proposedBand: 6.0,
        },
      });
      attemptId = attempt.id;
      itemId = item.id;
      cookieExaminer = await login('examiner@speakio.com', 'password123');
    });

    it('resolves with a final band, creating one score and completing the attempt', async () => {
      const res = await request(app.getHttpServer())
        .post(`/scoring/review-queue/${itemId}/resolve`)
        .set('Cookie', cookieExaminer)
        .send({ action: 'OVERRIDE', finalBand: 7.0, instructorNotes: 'QA override' })
        .expect(201);
      expect(res.body.status).toBe('OVERRIDDEN');

      const score = await prisma.score.findUniqueOrThrow({
        where: { attemptId_skill: { attemptId, skill: 'WRITING' } },
      });
      expect(score.bandScore).toBe(7.0);
      expect(score.scoredBy).toBe('INSTRUCTOR');

      const attempt = await prisma.attempt.findUniqueOrThrow({ where: { id: attemptId } });
      expect(attempt.status).toBe('COMPLETED');
    });

    it('rejects re-resolution of an already-resolved item', async () => {
      await request(app.getHttpServer())
        .post(`/scoring/review-queue/${itemId}/resolve`)
        .set('Cookie', cookieExaminer)
        .send({ action: 'APPROVE', finalBand: 6.5 })
        .expect(409);
    });

    it('validates the final band value', async () => {
      await request(app.getHttpServer())
        .post(`/scoring/review-queue/${itemId}/resolve`)
        .set('Cookie', cookieExaminer)
        .send({ action: 'APPROVE', finalBand: 7.3 })
        .expect(400);
    });

    it('forbids STUDENT resolution attempts', async () => {
      const cookieA = await login(USER_A.email, USER_A.password);
      await request(app.getHttpServer())
        .post(`/scoring/review-queue/${itemId}/resolve`)
        .set('Cookie', cookieA)
        .send({ action: 'APPROVE', finalBand: 6.5 })
        .expect(403);
    });

    afterAll(async () => {
      await prisma.attempt.deleteMany({ where: { id: attemptId } });
    });
  });

  describe('Essay validation boundary', () => {
    it('rejects essays below the 20-word floor on /scoring/writing', async () => {
      const cookie = await login(USER_A.email, USER_A.password);
      const userA = await prisma.user.findUniqueOrThrow({ where: { email: USER_A.email } });
      const attempt = await prisma.attempt.create({
        data: {
          id: `qa-attempt-w-${ts}`,
          userId: userA.id,
          testSetId: 'cambridge-18-test-1',
          status: 'IN_PROGRESS',
          answersJson: {},
        },
      });
      await request(app.getHttpServer())
        .post('/scoring/writing')
        .set('Cookie', cookie)
        .send({
          attemptId: attempt.id,
          questionPrompt: 'Some people believe X. Discuss.',
          taskType: 'TASK_2',
          studentEssay: 'Too short essay.',
        })
        .expect(400);
      await prisma.attempt.delete({ where: { id: attempt.id } });
    });
  });

  it('rate-limits excessive login attempts (last one in a burst of 11 fails)', async () => {
    let sawThrottled = false;
    for (let i = 0; i < 11; i++) {
      const res = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email: `ratelimit-${i}@speakio.test`, password: 'Whatever1!' });
      if (res.status === 429) sawThrottled = true;
    }
    expect(sawThrottled).toBe(true);
  });
});
