/* eslint-disable @typescript-eslint/no-require-imports */
/* Direct PostgreSQL verification for browser E2E tests.
 * Reads DATABASE_URL from backend/.env and uses the backend's installed `pg`.
 * Usage: node tests/helpers/db-verify.cjs <mode> <key>
 *   user <email>   -> user row(s)
 *   vocab <word>   -> custom vocabulary rows
 *   attempt <id>   -> attempt row
 *   studyplan <email> -> study plan / exam date row
 *   counts         -> table counts
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const ROOT = path.resolve(__dirname, '..', '..');
const backendDir = path.join(ROOT, 'backend');
const req = createRequire(path.join(backendDir, 'package.json'));
const { Client } = req('pg');

function databaseUrl() {
  const envPath = path.join(backendDir, '.env');
  const text = fs.readFileSync(envPath, 'utf8');
  const m = text.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error('DATABASE_URL not found in backend/.env');
  return m[1];
}

async function run() {
  const [mode, key] = process.argv.slice(2);
  const client = new Client({ connectionString: databaseUrl(), connectionTimeoutMillis: 15000 });
  await client.connect();
  try {
    let sql, params = [];
    switch (mode) {
      case 'user':
        sql = 'select id, email, name, role, status, "targetBand", "createdAt" from users where lower(email) = lower($1)';
        params = [key];
        break;
      case 'vocab':
        sql = 'select id, word, definition, topic, "bandTarget" from vocabulary_items where lower(word) = lower($1) order by "createdAt" desc';
        params = [key];
        break;
      case 'attempt':
        sql = 'select id, status, "testSetId", "submittedAt", "questionIdsJson", "answersJson", "timeRemainingSeconds" from attempts where id = $1';
        params = [key];
        break;
      case 'latestattempt':
        sql = `select a.id, a.status, a."testSetId", a."submittedAt", a."answersJson", a."questionIdsJson"
               from attempts a join users u on u.id = a."userId"
               where lower(u.email) = lower($1) order by a."startedAt" desc limit 1`;
        params = [key];
        break;
      case 'studyplan':
        sql = 'select email, "examDate", "dailyCommitmentMinutes", "weakestSkill", "studyPlanJson" from users where lower(email) = lower($1)';
        params = [key];
        break;
      case 'scores':
        sql = `select id, skill, "bandScore", "taskAchievement", "coherenceCohesion",
                      "lexicalResource", "grammaticalAccuracy", "feedbackSummary", "scoredBy", confidence
               from scores where "attemptId" = $1`;
        params = [key];
        break;
      case 'cert':
        sql = `select "certificateNumber", "verificationCode", status, "overallBand"
               from certificates order by "issuedAt" desc limit 1`;
        break;
      case 'counts':
        sql = `select
          (select count(*) from users)::int as users,
          (select count(*) from attempts)::int as attempts,
          (select count(*) from test_sets)::int as testsets,
          (select count(*) from questions)::int as questions,
          (select count(*) from vocabulary_items)::int as vocabulary,
          (select count(*) from certificates)::int as certificates,
          (select count(*) from agent_runs)::int as agentruns`;
        break;
      default:
        throw new Error('unknown mode: ' + mode);
    }
    const { rows } = await client.query(sql, params);
    process.stdout.write(JSON.stringify(rows));
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  process.stderr.write(String(e && e.message ? e.message : e));
  process.exitCode = 1;
});
