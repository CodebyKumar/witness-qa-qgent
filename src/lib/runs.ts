import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verify } from "./llm";
import { asObservation, getRunDetails, runTestCase } from "./tinyfish";
import type { Run, TestCase, TestResult } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "runs");
const CONCURRENCY = Math.max(1, Number(process.env.TF_CONCURRENCY ?? 2));

// shortcut: in-process store, so one server instance only; move to a DB if this is ever deployed multi-instance.
const g = globalThis as unknown as { __runs?: Map<string, Run>; __bus?: EventEmitter };
const runs = (g.__runs ??= new Map());
const bus = (g.__bus ??= new EventEmitter().setMaxListeners(100));

export const onRunUpdate = (id: string, fn: (r: TestResult) => void) => {
  bus.on(id, fn);
  return () => bus.off(id, fn);
};

const save = (run: Run) => writeFile(path.join(DATA_DIR, `${run.id}.json`), JSON.stringify(run, null, 2)).catch(() => {});

function update(run: Run, caseId: string, patch: Partial<TestResult>) {
  const r = Object.assign(run.results[caseId], patch);
  bus.emit(run.id, r);
  void save(run);
}

export async function getRun(id: string): Promise<Run | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  const hit = runs.get(id);
  if (hit) return hit;
  try {
    return JSON.parse(await readFile(path.join(DATA_DIR, `${id}.json`), "utf8")) as Run;
  } catch {
    return null;
  }
}

export async function listRuns() {
  await mkdir(DATA_DIR, { recursive: true });
  const files = (await readdir(DATA_DIR)).filter((f) => f.endsWith(".json"));
  const all = await Promise.all(files.map(async (f) => JSON.parse(await readFile(path.join(DATA_DIR, f), "utf8")) as Run));
  return all.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function startRun(id: string, url: string, cases: TestCase[]) {
  await mkdir(DATA_DIR, { recursive: true });
  const run: Run = {
    id,
    url,
    createdAt: new Date().toISOString(),
    cases,
    results: Object.fromEntries(cases.map((c) => [c.id, { caseId: c.id, status: "queued", progress: [] } satisfies TestResult])),
  };
  runs.set(id, run);
  await save(run);

  const queue = [...cases];
  const worker = async () => {
    for (let tc = queue.shift(); tc; tc = queue.shift()) await executeCase(run, tc);
  };
  void Promise.all(Array.from({ length: Math.min(CONCURRENCY, cases.length) }, worker));
  return run;
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const NOT_A_BUG = new Set(["TIMEOUT", "MAX_STEPS_EXCEEDED", "SITE_BLOCKED"]);

async function executeCase(run: Run, tc: TestCase, stealth = false): Promise<void> {
  update(run, tc.id, { status: "running", startedAt: run.results[tc.id].startedAt ?? new Date().toISOString() });
  let runId = "";
  let final: { status: string; result: Record<string, unknown> | null; error: { code?: string; message: string } | null } | null = null;

  try {
    final = await runTestCase(run.url, tc, (e) => {
      if (e.type === "STARTED") update(run, tc.id, { tinyfishRunId: (runId = e.run_id) });
      if (e.type === "STREAMING_URL") update(run, tc.id, { streamingUrl: e.streaming_url });
      if (e.type === "PROGRESS")
        update(run, tc.id, { progress: [...run.results[tc.id].progress, { at: new Date().toISOString(), text: e.purpose }] });
    }, stealth);
  } catch (err) {
    if (!runId) return finish(run, tc.id, { verdict: "ERROR", reason: `TinyFish rejected the run: ${(err as Error).message}` });
  }

  // Stream dropped before COMPLETE: poll the run until it ends.
  for (let i = 0; !final && runId && i < 120; i++) {
    const d = await getRunDetails(runId);
    if (d && TERMINAL.has(d.status)) final = { status: d.status, result: d.result ?? null, error: d.error ?? null };
    else await new Promise((r) => setTimeout(r, 3000));
  }
  if (!final) return finish(run, tc.id, { verdict: "ERROR", reason: "Lost contact with the TinyFish run" });

  const details = runId ? await getRunDetails(runId) : null;
  update(run, tc.id, { tfStatus: final.status, numSteps: details?.num_of_steps ?? undefined, tfSteps: details?.steps?.map(({ id, action, duration }) => ({ id, action, duration })), videoUrl: details?.video_url ?? undefined });

  if (final.status !== "COMPLETED") {
    const code = final.error?.code ?? final.status;
    if (code === "SITE_BLOCKED" && !stealth) return executeCase(run, tc, true);
    return finish(run, tc.id, {
      verdict: NOT_A_BUG.has(code) ? "BLOCKED" : "ERROR",
      reason: `TinyFish run ${code}: ${final.error?.message ?? "no details"}`,
      tfError: code,
    });
  }

  const obs = asObservation(final.result);
  update(run, tc.id, { status: "verifying", observation: obs });
  try {
    const v = await verify(tc, obs, obs ? "" : JSON.stringify(final.result));
    finish(run, tc.id, {
      verdict: v.verdict,
      reason: v.reason,
      expectedText: v.expected,
      observedText: v.observed,
      reproSteps: v.repro_steps,
      likelyCause: v.likely_cause,
    });
  } catch (err) {
    finish(run, tc.id, { verdict: "ERROR", reason: `Verifier failed: ${(err as Error).message}` });
  }
}

function finish(run: Run, caseId: string, patch: Partial<TestResult>) {
  update(run, caseId, { ...patch, status: "done", finishedAt: new Date().toISOString() });
}
