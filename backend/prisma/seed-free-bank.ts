/** Free bundled IELTS-style question bank: local content, zero API cost. Idempotent. */
import { PrismaClient, SkillType, ModuleType, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

type Item = { id: string; questionType: string; prompt: string; options?: string[]; correctAnswer?: string; acceptedAnswers?: string[] };
type Set = { id: string; title: string; skill: SkillType; minutes: number; passage?: string; items: Item[] };

const BANK: Set[] = [
  {
    id: 'free-reading-bank', title: 'Free Reading Bank — Academic Passages', skill: SkillType.READING, minutes: 20,
    passage: 'Urban Green Spaces and Public Health\n\nAccess to green space is increasingly recognised as a determinant of public health. A review of municipal records found that districts with more than twenty per cent tree cover reported lower rates of heat-related illness than comparable districts with little vegetation. Researchers caution, however, that the relationship is not purely causal: wealthier neighbourhoods tend to have both more trees and better healthcare.\n\nThe design of a park also matters. Spaces with multiple entrances, lighting and maintained paths are used more consistently by older residents and families with young children. Isolated or poorly maintained sites are avoided after dark. Planners therefore recommend distributing small parks throughout a city rather than concentrating investment in a single large site.\n\nWater management is a further benefit. Permeable surfaces and planted areas absorb rainfall, reducing the burden on drainage systems during storms. Cities adopting such measures report fewer incidents of localised flooding. Nevertheless, maintenance costs remain a barrier for smaller municipalities, and weak enforcement of planning rules can undermine sound designs.',
    items: [
      { id: 'fr-q1', questionType: 'MCQ', prompt: 'What did the municipal review compare?', options: ['Hospital funding across regions', 'Tree cover and heat-related illness', 'Air quality in rural areas', 'Public transport usage'], correctAnswer: 'Tree cover and heat-related illness' },
      { id: 'fr-q2', questionType: 'MCQ', prompt: 'Why is the relationship not purely causal?', options: ['The data was collected recently', 'Wealthier districts also had better healthcare', 'Trees grow slowly', 'Illness was self-reported'], correctAnswer: 'Wealthier districts also had better healthcare' },
      { id: 'fr-q3', questionType: 'MCQ', prompt: 'Which park feature is linked to consistent use by older residents?', options: ['Large lawns only', 'Multiple entrances and lighting', 'Exotic planting', 'Free parking'], correctAnswer: 'Multiple entrances and lighting' },
      { id: 'fr-q4', questionType: 'COMPLETION', prompt: 'The review found lower rates of ______-related illness in greener districts.', acceptedAnswers: ['heat'] },
      { id: 'fr-q5', questionType: 'COMPLETION', prompt: 'Planners recommend distributing small parks rather than concentrating investment in a single ______ site.', acceptedAnswers: ['large'] },
      { id: 'fr-q6', questionType: 'MCQ', prompt: 'How do planted areas help during storms?', options: ['They reflect sunlight', 'They absorb rainfall', 'They increase traffic flow', 'They lower prices'], correctAnswer: 'They absorb rainfall' },
      { id: 'fr-q7', questionType: 'MCQ', prompt: 'What is a barrier for smaller municipalities?', options: ['Lack of interest', 'Maintenance costs', 'Excess rainfall', 'Low population'], correctAnswer: 'Maintenance costs' },
      { id: 'fr-q8', questionType: 'COMPLETION', prompt: 'Weak enforcement of planning rules can ______ otherwise sound designs.', acceptedAnswers: ['undermine'] },
      { id: 'fr-q9', questionType: 'MCQ', prompt: 'Which statement matches the passage?', options: ['All large parks are unsuccessful', 'Green space is one factor among several', 'Healthcare is irrelevant', 'Trees eliminate heat illness'], correctAnswer: 'Green space is one factor among several' },
      { id: 'fr-q10', questionType: 'MCQ', prompt: 'The passage mainly discusses:', options: ['History of urban planning', 'Benefits and limits of urban green space', 'Hospital design', 'Storm damage'], correctAnswer: 'Benefits and limits of urban green space' },
      { id: 'fr-q11', questionType: 'COMPLETION', prompt: 'The text mentions districts with more than twenty ______ of tree cover.', acceptedAnswers: ['per cent', 'percent'] },
      { id: 'fr-q12', questionType: 'MCQ', prompt: 'Isolated sites are avoided after:', options: ['Rainfall', 'Dark', 'Midday', 'Weekends'], correctAnswer: 'Dark' },
    ],
  },
  {
    id: 'free-listening-bank', title: 'Free Listening Bank — Everyday Conversations', skill: SkillType.LISTENING, minutes: 30,
    passage: 'WOMAN: Good morning, I would like to register for the weekend photography workshop.\nMAN: Certainly. Could I have your full name?\nWOMAN: Sarah Miller. That is M-I-L-L-E-R.\nMAN: Thank you. The workshop begins at nine thirty on Saturday, and you should arrive fifteen minutes early to collect your camera.\nWOMAN: Where does it take place?\nMAN: In the art building, room two oh four. The fee is forty-five pounds, which includes a printed guide.\nWOMAN: Does it include lunch?\nMAN: No, but there is a cafe on the ground floor. Participants get a ten per cent discount there.\nWOMAN: Can I pay by card?\nMAN: Yes, we accept cards or cash.',
    items: [
      { id: 'fl-q1', questionType: 'MCQ', prompt: 'What is the caller surname?', options: ['Miller', 'Muller', 'Milar', 'Milner'], correctAnswer: 'Miller' },
      { id: 'fl-q2', questionType: 'MCQ', prompt: 'What time does the workshop start?', options: ['9:00', '9:15', '9:30', '10:00'], correctAnswer: '9:30' },
      { id: 'fl-q3', questionType: 'MCQ', prompt: 'Why should participants arrive early?', options: ['To pay the fee', 'To collect a camera', 'To meet the tutor', 'To choose a seat'], correctAnswer: 'To collect a camera' },
      { id: 'fl-q4', questionType: 'COMPLETION', prompt: 'The workshop is in room ______ of the art building.', acceptedAnswers: ['204', 'two oh four'] },
      { id: 'fl-q5', questionType: 'MCQ', prompt: 'How much is the fee?', options: ['40 pounds', '45 pounds', '50 pounds', '54 pounds'], correctAnswer: '45 pounds' },
      { id: 'fl-q6', questionType: 'MCQ', prompt: 'What is included in the fee?', options: ['Lunch', 'A printed guide', 'Transport', 'A camera'], correctAnswer: 'A printed guide' },
      { id: 'fl-q7', questionType: 'COMPLETION', prompt: 'Participants receive a ______ per cent discount at the cafe.', acceptedAnswers: ['10', 'ten'] },
      { id: 'fl-q8', questionType: 'MCQ', prompt: 'Which payment method is NOT mentioned?', options: ['Card', 'Cash', 'Bank transfer'], correctAnswer: 'Bank transfer' },
      { id: 'fl-q9', questionType: 'MCQ', prompt: 'Where is the cafe located?', options: ['Ground floor', 'Room 204', 'Outside the building', 'Second floor'], correctAnswer: 'Ground floor' },
      { id: 'fl-q10', questionType: 'COMPLETION', prompt: 'The workshop takes place on ______.', acceptedAnswers: ['Saturday'] },
    ],
  },
  {
    id: 'free-writing-bank', title: 'Free Writing Bank — Task 2 Prompts', skill: SkillType.WRITING, minutes: 60,
    items: [
      { id: 'fw-q1', questionType: 'ESSAY', prompt: 'Some people believe universities should focus on practical skills rather than academic theory. To what extent do you agree or disagree?' },
      { id: 'fw-q2', questionType: 'ESSAY', prompt: 'In many countries, people are working longer hours. What are the advantages and disadvantages of this trend?' },
      { id: 'fw-q3', questionType: 'ESSAY', prompt: 'Some governments invest in public libraries while others spend on digital services. Discuss both views and give your own opinion.' },
      { id: 'fw-q4', questionType: 'ESSAY', prompt: 'Many young people prefer to live in cities rather than rural areas. Why is this happening? Is it a positive or negative development?' },
      { id: 'fw-q5', questionType: 'ESSAY', prompt: 'Some believe environmental protection is the responsibility of individuals, not governments. To what extent do you agree?' },
      { id: 'fw-q6', questionType: 'ESSAY', prompt: 'Online learning has become common. Discuss the benefits and drawbacks of studying online compared with classroom education.' },
    ],
  },
  {
    id: 'free-speaking-bank', title: 'Free Speaking Bank — Part 2 Cue Cards', skill: SkillType.SPEAKING, minutes: 15,
    items: [
      { id: 'fs-q1', questionType: 'SPEAKING_PROMPT', prompt: 'Describe a book you enjoyed reading. Say what it was, when you read it, why you chose it, and explain how it influenced you.' },
      { id: 'fs-q2', questionType: 'SPEAKING_PROMPT', prompt: 'Describe a place you visit to relax. Say where it is, how often you go, what you do there, and explain why it helps.' },
      { id: 'fs-q3', questionType: 'SPEAKING_PROMPT', prompt: 'Describe a person who taught you something useful. Say who they are, what they taught, how, and explain why it was useful.' },
      { id: 'fs-q4', questionType: 'SPEAKING_PROMPT', prompt: 'Describe a memorable journey. Say where you went, who you travelled with, what happened, and explain why it was memorable.' },
      { id: 'fs-q5', questionType: 'SPEAKING_PROMPT', prompt: 'Describe a piece of technology you use every day. Say what it is, how you use it, and explain why it is important to you.' },
      { id: 'fs-q6', questionType: 'SPEAKING_PROMPT', prompt: 'Describe a goal you would like to achieve. Say what it is, why you want it, your plan, and what success would mean.' },
    ],
  },
];

async function main() {
  for (const set of BANK) {
    await prisma.testSet.upsert({
      where: { id: set.id }, update: {},
      create: { id: set.id, title: set.title, skill: set.skill, moduleType: ModuleType.ACADEMIC, timeLimitMinutes: set.minutes },
    });
    for (let index = 0; index < set.items.length; index++) {
      const item = set.items[index];
      const meta: Record<string, unknown> = {};
      if (item.options) { meta.options = item.options; meta.correctAnswer = item.correctAnswer; }
      if (item.acceptedAnswers) { meta.acceptedAnswers = item.acceptedAnswers; meta.correctAnswer = item.acceptedAnswers[0]; }
      const metadata = meta as Prisma.InputJsonValue;
      await prisma.question.upsert({
        where: { id: item.id }, update: {},
        create: { id: item.id, testSetId: set.id, partNumber: 1, questionType: item.questionType, prompt: item.prompt, passage: index === 0 ? set.passage : null, metadata, orderIndex: index },
      });
    }
    console.log(`Free bank ready: ${set.title} (${set.items.length} questions)`);
  }
}
main().catch((error) => { console.error(error); process.exit(1); }).finally(async () => { await prisma.$disconnect(); });
