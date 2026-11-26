import { execFileSync } from "node:child_process";
import { resolve } from "node:path";

const SCRIPT = resolve(process.cwd(), "tests/helpers/db-verify.cjs");

export interface DbRow {
  [key: string]: unknown;
}

/** Run a read-only query against the real PostgreSQL database. */
export function dbQuery(mode: string, key = ""): DbRow[] {
  const out = execFileSync(process.execPath, [SCRIPT, mode, key], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: 30_000,
  });
  const json = out.trim();
  return json ? (JSON.parse(json) as DbRow[]) : [];
}

export function userInDb(email: string): DbRow | undefined {
  return dbQuery("user", email)[0];
}

export function vocabInDb(word: string): DbRow[] {
  return dbQuery("vocab", word);
}

export function attemptInDb(id: string): DbRow | undefined {
  return dbQuery("attempt", id)[0];
}

export function latestAttemptInDb(email: string): DbRow | undefined {
  return dbQuery("latestattempt", email)[0];
}

export function scoresInDb(attemptId: string): DbRow[] {
  return dbQuery("scores", attemptId);
}

export function studyPlanInDb(email: string): DbRow | undefined {
  return dbQuery("studyplan", email)[0];
}

export function latestCertificate(): DbRow | undefined {
  return dbQuery("cert")[0];
}
