import { PrismaClient } from '@prisma/client';
import * as jwt from 'jsonwebtoken';

const prisma = new PrismaClient();

async function testScoringAndReviewQueueFlow() {
  console.log('\nTesting End-to-End Scoring & Review Queue Flow...');

  // 1. Create Instructor User for Review
  const instructor = await prisma.user.upsert({
    where: { email: 'head.examiner@speakio.com' },
    update: {},
    create: {
      email: 'head.examiner@speakio.com',
      passwordHash: 'hashed_pw',
      name: 'Head Examiner Dr. Watson',
      role: 'INSTRUCTOR',
      targetBand: 9.0,
    },
  });

  const instructorToken = jwt.sign(
    { sub: instructor.id, email: instructor.email, role: instructor.role, name: instructor.name },
    process.env.JWT_SECRET || 'speakio_jwt_secure_secret_key_2026_production',
    { expiresIn: '1h' },
  );

  // 2. Create a Test Set and Attempt
  const testSet = await prisma.testSet.create({
    data: {
      title: 'E2E Verified Academic Test',
      skill: 'WRITING',
      timeLimitMinutes: 40,
      isMock: true,
    },
  });

  const attempt = await prisma.attempt.create({
    data: {
      userId: instructor.id,
      testSetId: testSet.id,
      status: 'NEEDS_REVIEW',
      answersJson: { essay: 'A comprehensive academic essay on urban sustainability...' },
    },
  });

  // 3. Create a pending ReviewQueueItem
  const queueItem = await prisma.reviewQueueItem.create({
    data: {
      attemptId: attempt.id,
      skill: 'WRITING',
      proposedBand: 6.5,
      status: 'PENDING',
      instructorNotes: 'Confidence score: 0.79 below threshold. Borderline coherence.',
    },
  });

  console.log(`Created test attempt: ${attempt.id}`);
  console.log(`Created pending review queue item: ${queueItem.id}`);

  // 4. Fetch Review Queue via API
  const queueRes = await fetch('http://localhost:4000/scoring/review-queue', {
    method: 'GET',
    headers: {
      Cookie: `access_token=${instructorToken}`,
    },
  });

  console.log(`GET /scoring/review-queue status: ${queueRes.status}`);
  const queueData = await queueRes.json();
  console.log(`Found ${queueData.length} pending item(s) in review queue.`);

  // 5. Resolve Review Queue Item (Override to Band 7.5)
  const resolveRes = await fetch(`http://localhost:4000/scoring/review-queue/${queueItem.id}/resolve`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Cookie: `access_token=${instructorToken}`,
    },
    body: JSON.stringify({
      action: 'OVERRIDE',
      finalBand: 7.5,
      instructorNotes: 'Verified and upgraded to Band 7.5 after reviewing lexical variety.',
    }),
  });

  console.log(`POST /scoring/review-queue/:id/resolve status: ${resolveRes.status}`);
  const resolveData = await resolveRes.json();
  console.log('Resolved Queue Result:', resolveData);

  // 6. Verify Score entry was recorded in DB
  const verifiedScore = await prisma.score.findFirst({
    where: { attemptId: attempt.id },
  });
  console.log('Final Score Recorded in DB:', verifiedScore);

  if (verifiedScore && verifiedScore.bandScore === 7.5 && verifiedScore.scoredBy === 'INSTRUCTOR') {
    console.log('\n[SUCCESS] Scoring, Review Queue, and Instructor Override flow fully working!');
  } else {
    console.error('\n[FAILURE] Scoring flow verification failed.');
  }

  await prisma.$disconnect();
}

testScoringAndReviewQueueFlow();
