import { PrismaClient, Prisma, SkillType, ModuleType } from '@prisma/client';

const prisma = new PrismaClient();

interface McqMetadata {
  [key: string]: Prisma.InputJsonValue;
  options: string[];
  correctAnswer: string;
}

interface CompletionMetadata {
  [key: string]: Prisma.InputJsonValue;
  acceptedAnswers: string[];
}

async function main() {
  console.log('Seeding Speakio IELTS test content...');

  // No accounts, attempts or certificates are seeded — real users register
  // themselves. Bootstrap the first admin with prisma/create-admin.ts instead.
  // Test content below is idempotent and safe to run on an existing database.

  // 2. WRITING test set
  const writingSet = await prisma.testSet.upsert({
    where: { id: 'cambridge-18-test-1' },
    update: {},
    create: {
      id: 'cambridge-18-test-1',
      title: 'Writing Task 2 — Community Service Essay',
      skill: SkillType.WRITING,
      moduleType: ModuleType.ACADEMIC,
      timeLimitMinutes: 40,
      isMock: false,
    },
  });

  await prisma.question.upsert({
    where: { id: 'c18-w-task2' },
    update: {},
    create: {
      id: 'c18-w-task2',
      testSetId: writingSet.id,
      partNumber: 2,
      questionType: 'ESSAY',
      prompt:
        'Some people believe that unpaid community service should be a compulsory part of high school programmes. To what extent do you agree or disagree with this statement?',
      orderIndex: 1,
    },
  });

  await prisma.testSet.upsert({
    where: { id: 'cambridge-18-task1-chart' },
    update: {},
    create: {
      id: 'cambridge-18-task1-chart',
      title: 'Writing Task 1 — Urban Population Chart',
      skill: SkillType.WRITING,
      moduleType: ModuleType.ACADEMIC,
      timeLimitMinutes: 20,
      isMock: false,
    },
  });
  await prisma.question.upsert({
    where: { id: 'c18-w-task1-chart' },
    update: {},
    create: {
      id: 'c18-w-task1-chart',
      testSetId: 'cambridge-18-task1-chart',
      partNumber: 1,
      questionType: 'ESSAY',
      prompt:
        'The chart below shows the percentage of households in owned and rented accommodation in England and Wales between 1918 and 2011. Summarise the information by selecting and reporting the main features, and make comparisons where relevant. Write at least 150 words. (Describe the chart in your introduction and analyse the key trends over time.)',
      passage:
        'Data summary: 1918 — 23% owned / 77% rented. 1939 — 31% owned. 1953 — 32% owned. 1961 — 41% owned. 1971 — 50% owned. 1981 — 58% owned. 1991 — 65% owned. 2001 — 69% owned. 2011 — 64% owned / 36% rented.',
      orderIndex: 1,
    },
  });

  // 3. LISTENING test set with auto-gradable MCQs
  const listeningSet = await prisma.testSet.upsert({
    where: { id: 'listening-section1-uni-orientation' },
    update: {},
    create: {
      id: 'listening-section1-uni-orientation',
      title: 'Listening Section 1 — University Orientation Dialogue',
      skill: SkillType.LISTENING,
      moduleType: ModuleType.ACADEMIC,
      timeLimitMinutes: 15,
      isMock: false,
    },
  });

  const listeningQuestions: Array<{
    id: string;
    order: number;
    prompt: string;
    meta: McqMetadata;
    transcript: string;
  }> = [
    {
      id: 'lis-s1-q1',
      order: 1,
      prompt: 'What time does the orientation session begin?',
      meta: { options: ['8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM'], correctAnswer: '9:30 AM' },
      transcript:
        'Narrator: You will hear a conversation between a new student and a university adviser. Adviser: The welcome talk starts at half past nine in the Main Hall, so please arrive by quarter past.',
    },
    {
      id: 'lis-s1-q2',
      order: 2,
      prompt: 'Where should students collect their campus pass?',
      meta: {
        options: ['Library reception', 'Student Services Office', 'Main Hall entrance', 'Sports Centre'],
        correctAnswer: 'Student Services Office',
      },
      transcript:
        'Adviser: You can pick up your campus pass from the Student Services Office — that is Building B, just opposite the library.',
    },
    {
      id: 'lis-s1-q3',
      order: 3,
      prompt: 'Which document must students bring to registration?',
      meta: {
        options: ['A birth certificate', 'A bank statement', 'Passport-sized photographs', 'A medical report'],
        correctAnswer: 'Passport-sized photographs',
      },
      transcript:
        'Adviser: Please remember to bring two passport-sized photographs; we cannot complete registration without them.',
    },
    {
      id: 'lis-s1-q4',
      order: 4,
      prompt: 'How much does the full-year bus pass cost?',
      meta: { options: ['£95', '£115', '£150', '£190'], correctAnswer: '£150' },
      transcript:
        'Adviser: The annual transport pass is one hundred and fifty pounds, which works out cheaper than the termly option.',
    },
    {
      id: 'lis-s1-q5',
      order: 5,
      prompt: 'What is the adviser’s email address?',
      meta: {
        options: ['adviser@uni.ac.uk', 'helpdesk@uni.ac.uk', 'orientation@uni.ac.uk', 'support@uni.ac.uk'],
        correctAnswer: 'orientation@uni.ac.uk',
      },
      transcript: 'Adviser: If you have any questions, write to orientation@uni.ac.uk and someone will reply within a day.',
    },
    {
      id: 'lis-s1-q6',
      order: 6,
      prompt: 'The welcome lecture will be held in the ______.',
      meta: {
        options: ['Main Hall', 'Lecture Theatre C', 'Science Block', 'Common Room'],
        correctAnswer: 'Main Hall',
      },
      transcript: 'Adviser: As I mentioned, the welcome talk takes place in the Main Hall.',
    },
    {
      id: 'lis-s1-q7',
      order: 7,
      prompt: 'Students must arrive ______ minutes before the talk begins.',
      meta: { options: ['5', '10', '15', '20'], correctAnswer: '15' },
      transcript: 'Adviser: Please arrive by quarter past — that gives you fifteen minutes before the start.',
    },
    {
      id: 'lis-s1-q8',
      order: 8,
      prompt: 'The campus pass office is located in Building ______.',
      meta: { options: ['A', 'B', 'C', 'D'], correctAnswer: 'B' },
      transcript: 'Adviser: Student Services is Building B, just opposite the library.',
    },
    {
      id: 'lis-s1-q9',
      order: 9,
      prompt: 'Registration cannot be completed without ______.',
      meta: {
        options: ['photographs', 'a bank statement', 'a medical report', 'a birth certificate'],
        correctAnswer: 'photographs',
      },
      transcript: 'Adviser: We cannot complete registration without the photographs.',
    },
    {
      id: 'lis-s1-q10',
      order: 10,
      prompt: 'Queries are answered within ______.',
      meta: { options: ['a few hours', 'one day', 'two days', 'one week'], correctAnswer: 'one day' },
      transcript: 'Adviser: Someone will reply within a day.',
    },
  ];

  for (const q of listeningQuestions) {
    await prisma.question.upsert({
      where: { id: q.id },
      update: {},
      create: {
        id: q.id,
        testSetId: listeningSet.id,
        partNumber: 1,
        questionType: 'MCQ',
        prompt: q.prompt,
        metadata: q.meta,
        passage: q.transcript,
        orderIndex: q.order,
      },
    });
  }

  // 4. READING test set with MCQ + completion
  const readingSet = await prisma.testSet.upsert({
    where: { id: 'reading-passage-urban-green' },
    update: {},
    create: {
      id: 'reading-passage-urban-green',
      title: 'Reading Passage 1 — Urban Green Spaces',
      skill: SkillType.READING,
      moduleType: ModuleType.ACADEMIC,
      timeLimitMinutes: 20,
      isMock: false,
    },
  });

  const readingPassage = `Urban green spaces, ranging from pocket parks to extensive urban forests, have become central to municipal planning discourse. Historically, parks were viewed as ornamental luxuries; contemporary research, however, positions them as critical infrastructure. Evidence from longitudinal cohort studies indicates that residents within 300 metres of substantial green space report measurably lower incidences of cardiovascular disease and psychological distress. Economists have attempted to quantify this "green premium": properties adjacent to well-maintained parks command price uplifts of five to twenty percent, though critics caution that such appreciation may displace lower-income renters — a phenomenon termed "green gentrification". Planners increasingly advocate "green corridors", continuous vegetated routes that connect neighbourhoods, enabling both species migration and active commuting. Copenhagen's cycling superhighways, for instance, pair planted buffer strips with dedicated lanes, and the city reports a 38 percent increase in cycle commuting over a decade. Nevertheless, maintenance funding remains the Achilles heel of urban greening; a neglected park can rapidly transition from civic asset to perceived no-go zone, illustrating that installation without stewardship risks squandering public investment.`;

  const readingQuestions: Array<{
    id: string;
    order: number;
    type: 'MCQ' | 'COMPLETION';
    prompt: string;
    meta: McqMetadata | CompletionMetadata;
  }> = [
    {
      id: 'read-p1-q1',
      order: 1,
      type: 'MCQ',
      prompt: 'Historically, urban parks were regarded as ______.',
      meta: {
        options: ['essential infrastructure', 'decorative luxuries', 'public health tools', 'economic burdens'],
        correctAnswer: 'decorative luxuries',
      },
    },
    {
      id: 'read-p1-q2',
      order: 2,
      type: 'MCQ',
      prompt: 'Research cited in the passage links proximity to green space with lower rates of ______.',
      meta: {
        options: ['unemployment', 'cardiovascular disease', 'traffic accidents', 'property crime'],
        correctAnswer: 'cardiovascular disease',
      },
    },
    {
      id: 'read-p1-q3',
      order: 3,
      type: 'MCQ',
      prompt: 'The "green premium" refers to ______.',
      meta: {
        options: [
          'a tax on developers',
          'increased property values near parks',
          'the cost of maintaining parks',
          'government grants for planting',
        ],
        correctAnswer: 'increased property values near parks',
      },
    },
    {
      id: 'read-p1-q4',
      order: 4,
      type: 'MCQ',
      prompt: '"Green gentrification" describes the displacement of ______ due to rising costs near parks.',
      meta: {
        options: ['small businesses', 'lower-income renters', 'city planners', 'wildlife habitats'],
        correctAnswer: 'lower-income renters',
      },
    },
    {
      id: 'read-p1-q5',
      order: 5,
      type: 'MCQ',
      prompt: 'Green corridors are designed to ______.',
      meta: {
        options: [
          'reduce park maintenance costs',
          'connect neighbourhoods for wildlife and commuters',
          'replace cycling infrastructure',
          'increase property prices',
        ],
        correctAnswer: 'connect neighbourhoods for wildlife and commuters',
      },
    },
    {
      id: 'read-p1-q6',
      order: 6,
      type: 'MCQ',
      prompt: 'Copenhagen reports cycle commuting has increased by ______ over ten years.',
      meta: { options: ['28%', '30%', '38%', '48%'], correctAnswer: '38%' },
    },
    {
      id: 'read-p1-q7',
      order: 7,
      type: 'COMPLETION',
      prompt: 'A neglected park can become a perceived ______ zone. (ONE WORD)',
      meta: { acceptedAnswers: ['no-go', 'nogo', 'no go'] },
    },
    {
      id: 'read-p1-q8',
      order: 8,
      type: 'COMPLETION',
      prompt: 'Properties near parks command price uplifts of between five and ______ percent. (ONE WORD / NUMBER)',
      meta: { acceptedAnswers: ['twenty', '20'] },
    },
    {
      id: 'read-p1-q9',
      order: 9,
      type: 'COMPLETION',
      prompt: 'The passage describes maintenance funding as the ______ of urban greening. (ONE WORD)',
      meta: { acceptedAnswers: ['achilles heel', 'achilles'] },
    },
    {
      id: 'read-p1-q10',
      order: 10,
      type: 'COMPLETION',
      prompt: 'Copenhagen pairs planted buffer strips with dedicated ______ lanes. (ONE WORD)',
      meta: { acceptedAnswers: ['cycle', 'cycling', 'bike'] },
    },
  ];

  for (const q of readingQuestions) {
    await prisma.question.upsert({
      where: { id: q.id },
      update: {},
      create: {
        id: q.id,
        testSetId: readingSet.id,
        partNumber: 1,
        questionType: q.type,
        prompt: q.prompt,
        passage: q.order === 1 ? readingPassage : undefined,
        metadata: q.meta,
        orderIndex: q.order,
      },
    });
  }
  // Attach the full passage to the first question only (UI renders from q1) — ensure others have it null.

  // 5. SPEAKING test set (prompts; submitted attempts are scored by AI agents)
  await prisma.testSet.upsert({
    where: { id: 'speaking-part2-cuecard' },
    update: {},
    create: {
      id: 'speaking-part2-cuecard',
      title: 'Speaking Part 2 — Cue Card Long Turn',
      skill: SkillType.SPEAKING,
      moduleType: ModuleType.ACADEMIC,
      timeLimitMinutes: 5,
      isMock: false,
    },
  });
  await prisma.question.upsert({
    where: { id: 'spk-p2-q1' },
    update: {},
    create: {
      id: 'spk-p2-q1',
      testSetId: 'speaking-part2-cuecard',
      partNumber: 2,
      questionType: 'SPEAKING_PROMPT',
      prompt:
        'Describe a skill you would like to master in the future. You should say: what the skill is; how you would learn it; how long you think it would take; and explain why you want to master it.',
      orderIndex: 1,
    },
  });

  console.log('Seeded IELTS test content only — no demo accounts, attempts or certificates.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
