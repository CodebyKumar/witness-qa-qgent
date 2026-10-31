import { EventEmitter } from "node:events";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { verify } from "./llm";
import { asObservation, cancelRun, getRunDetails, MAX_DURATION_S, runTestCase, saveScreenshots } from "./tinyfish";
import type { Run, RunControl, TestCase, TestResult } from "./types";

const DATA_DIR = path.join(process.cwd(), "data", "runs");
export const SHOTS_DIR = path.join(process.cwd(), "data", "shots");
const CONCURRENCY = Math.max(1, Number(process.env.TF_CONCURRENCY ?? 2));

export type RunEvent = { event: "result"; data: TestResult } | { event: "control"; data: RunControl };

// shortcut: in-process store, so one server instance only; move to a DB if this is ever deployed multi-instance.
const g = globalThis as unknown as { __runs?: Map<string, Run>; __bus?: EventEmitter; __live?: Map<string, AbortController> };
const runs = (g.__runs ??= new Map());
const bus = (g.__bus ??= new EventEmitter().setMaxListeners(100));
const live = (g.__live ??= new Map()); // `${runId}/${caseId}` -> abort for the TinyFish stream

// One concurrency limit for the whole app: the TinyFish account caps concurrent agents, not each run.
const slots = ((g as { __slots?: { free: number; waiters: (() => void)[] } }).__slots ??= { free: CONCURRENCY, waiters: [] });
const acquire = () => (slots.free > 0 ? (slots.free--, Promise.resolve()) : new Promise<void>((r) => slots.waiters.push(r)));
const release = () => {
  const next = slots.waiters.shift();
  if (next) next();
  else slots.free++;
};
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const onRunEvent = (id: string, fn: (e: RunEvent) => void) => {
  bus.on(id, fn);
  return () => bus.off(id, fn);
};

// Saves are chained per run so an older snapshot can never finish writing after a newer one.
const saving = new Map<string, Promise<void>>();
const save = (run: Run) => {
  const next = (saving.get(run.id) ?? Promise.resolve()).then(() =>
    writeFile(path.join(DATA_DIR, `${run.id}.json`), JSON.stringify(run, null, 2)).catch(() => {}),
  );
  saving.set(run.id, next);
  return next;
};

function update(run: Run, caseId: string, patch: Partial<TestResult>) {
  const r = Object.assign(run.results[caseId], patch);
  bus.emit(run.id, { event: "result", data: r } satisfies RunEvent);
  void save(run);
}

function setControl(run: Run, control: RunControl) {
  run.control = control;
  bus.emit(run.id, { event: "control", data: control } satisfies RunEvent);
  void save(run);
}

export const isActive = (r: TestResult) => r.status === "queued" || r.status === "running" || r.status === "verifying";

export async function getRun(id: string): Promise<Run | null> {
  if (!/^[\w-]+$/.test(id)) return null;
  const hit = runs.get(id);
  if (hit) return hit;
  try {
    const run = JSON.parse(await readFile(path.join(DATA_DIR, `${id}.json`), "utf8")) as Run;
    // Not in memory means the server restarted: anything still "active" on disk will never finish.
    for (const r of Object.values(run.results)) if (isActive(r)) Object.assign(r, { status: "cancelled", reason: "Interrupted by a server restart" });
    run.control = "finished";
    // Runs saved before screenshots were stored on disk: fetch their evidence once.
    const missing = Object.values(run.results).filter((r) => r.tinyfishRunId && !r.shots);
    await Promise.all(
      missing.map(async (r) => {
        const steps = (await getRunDetails(r.tinyfishRunId!))?.steps ?? [];
        r.shots = await saveScreenshots(r.tinyfishRunId!, steps, path.join(SHOTS_DIR, r.tinyfishRunId!)).catch(() => []);
      }),
    );
    if (missing.length) await save(run);
    runs.set(id, run);
    return run;
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

/** Compact row for the history table and the sidebar. */
export function summarize(run: Run) {
  const r = Object.values(run.results);
  const n = (v: string) => r.filter((x) => x.verdict === v).length;
  return {
    id: run.id,
    url: run.url,
    host: new URL(run.url).host,
    createdAt: run.createdAt,
    total: run.cases.length,
    pass: n("PASS"),
    fail: n("FAIL"),
    other: n("BLOCKED") + n("ERROR"),
    active: r.some(isActive),
  };
}
export type RunSummary = ReturnType<typeof summarize>;

const freshResult = (caseId: string): TestResult => ({ caseId, status: "queued", progress: [] });

export async function startRun(id: string, url: string, cases: TestCase[]) {
  await mkdir(DATA_DIR, { recursive: true });
  const run: Run = {
    id,
    url,
    createdAt: new Date().toISOString(),
    control: "running",
    cases,
    results: Object.fromEntries(cases.map((c) => [c.id, freshResult(c.id)])),
  };
  runs.set(id, run);
  await save(run);
  void drain(run);
  return run;
}

/** Workers pull queued cases until none are left. Pause holds new starts; running cases finish. */
async function drain(run: Run) {
  const next = () => run.cases.find((c) => run.results[c.id].status === "queued");
  const worker = async () => {
    for (;;) {
      while (run.control === "paused") await sleep(500);
      if (run.control === "stopped" || !next()) return;
      await acquire();
      const tc = run.control === "running" ? next() : undefined; // state may have changed while waiting for a slot
      if (!tc) {
        release();
        continue;
      }
      update(run, tc.id, { status: "running" }); // claim before any await so two workers never take the same case
      try {
        await executeCase(run, tc);
      } finally {
        release();
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  if (!Object.values(run.results).some(isActive)) setControl(run, "finished");
}

export async function controlRun(id: string, action: "pause" | "resume" | "stop" | "retry", caseId?: string) {
  const run = runs.get(id);
  if (!run) return "This run is no longer live. Start it again from the report.";
  if (action === "pause" && run.control === "running") setControl(run, "paused");
  if (action === "resume" && run.control === "paused") setControl(run, "running");
  if (action === "stop" && (run.control === "running" || run.control === "paused")) {
    setControl(run, "stopped");
    for (const c of run.cases) {
      const r = run.results[c.id];
      if (r.status === "queued") update(run, c.id, { status: "cancelled", reason: "Stopped before it started" });
      if (r.status === "running") {
        if (r.tinyfishRunId) void cancelRun(r.tinyfishRunId);
        live.get(`${id}/${c.id}`)?.abort();
      }
    }
  }
  if (action === "retry" && caseId && run.results[caseId] && !isActive(run.results[caseId])) {
    run.results[caseId] = freshResult(caseId);
    update(run, caseId, {});
    if (run.control !== "running" && run.control !== "paused") {
      setControl(run, "running");
      void drain(run);
    }
  }
  return null;
}

const TERMINAL = new Set(["COMPLETED", "FAILED", "CANCELLED"]);
const NOT_A_BUG = new Set(["TIMEOUT", "MAX_STEPS_EXCEEDED", "SITE_BLOCKED"]);

async function executeCase(run: Run, tc: TestCase, stealth = false, attempt = 0): Promise<void> {
  const key = `${run.id}/${tc.id}`;
  const abort = new AbortController();
  live.set(key, abort);
  let runId = "";
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    if (runId) void cancelRun(runId);
    abort.abort();
  }, (MAX_DURATION_S + 15) * 1000);
  update(run, tc.id, { status: "running", startedAt: run.results[tc.id].startedAt ?? new Date().toISOString() });
  let final: { status: string; result: Record<string, unknown> | null; error: { code?: string; message: string } | null } | null = null;

  try {
    final = await runTestCase(
      run.url,
      tc,
      (e) => {
        if (e.type === "STARTED") update(run, tc.id, { tinyfishRunId: (runId = e.run_id) });
        if (e.type === "STREAMING_URL") update(run, tc.id, { streamingUrl: e.streaming_url });
        if (e.type === "PROGRESS") update(run, tc.id, { progress: [...run.results[tc.id].progress, { at: new Date().toISOString(), text: e.purpose }] });
      },
      stealth,
      abort.signal,
    );
  } catch (err) {
    if (abort.signal.aborted && !timedOut) return cancelled(run, tc.id);
    if (!runId && !timedOut) {
      if ((err as { statusCode?: number }).statusCode === 429 && attempt < 3) {
        const wait = 15 * (attempt + 1);
        update(run, tc.id, { progress: [...run.results[tc.id].progress, { at: new Date().toISOString(), text: `TinyFish is busy, retrying in ${wait}s` }] });
        await sleep(wait * 1000);
        return run.control === "stopped" ? cancelled(run, tc.id) : executeCase(run, tc, stealth, attempt + 1);
      }
      return finish(run, tc.id, { verdict: "ERROR", reason: `TinyFish rejected the run: ${(err as Error).message}` });
    }
  } finally {
    clearTimeout(timer);
    live.delete(key);
  }
  if (run.control === "stopped") return cancelled(run, tc.id);

  // Over the time limit: the agent was stuck. Judge from what it did so far instead of calling it an error.
  if (timedOut) {
    const details = runId ? await getRunDetails(runId) : null;
    const log = run.results[tc.id].progress.map((p) => `- ${p.text}`).join("\n");
    return judge(run, tc, runId, details, null, `The run was stopped at the ${MAX_DURATION_S}s time limit before the agent finished.\nActivity log:\n${log}`);
  }

  // Stream dropped before COMPLETE: poll the run until it ends.
  for (let i = 0; !final && runId && i < 120; i++) {
    const d = await getRunDetails(runId);
    if (d && TERMINAL.has(d.status)) final = { status: d.status, result: d.result ?? null, error: d.error ?? null };
    else await new Promise((r) => setTimeout(r, 3000));
  }
  if (!final) return finish(run, tc.id, { verdict: "ERROR", reason: "Lost contact with the TinyFish run" });
  if (final.status === "CANCELLED") return cancelled(run, tc.id);

  const details = runId ? await getRunDetails(runId) : null;
  update(run, tc.id, { tfStatus: final.status });

  if (final.status !== "COMPLETED") {
    const code = final.error?.code ?? final.status;
    if (code === "SITE_BLOCKED" && !stealth) return executeCase(run, tc, true);
    if (code === "RATE_LIMIT_EXCEEDED" && attempt < 3) {
      await sleep(15_000 * (attempt + 1));
      return executeCase(run, tc, stealth, attempt + 1);
    }
    return finish(run, tc.id, {
      verdict: NOT_A_BUG.has(code) ? "BLOCKED" : "ERROR",
      reason: `TinyFish run ${code}: ${final.error?.message ?? "no details"}`,
      tfError: code,
      ...(await evidence(runId, details)),
    });
  }

  const obs = asObservation(final.result);
  return judge(run, tc, runId, details, obs, obs ? "" : JSON.stringify(final.result));
}

type Details = Awaited<ReturnType<typeof getRunDetails>>;

/** Step count, recording link and screenshots saved to disk. */
async function evidence(runId: string, details: Details) {
  const shots = details?.steps?.length ? await saveScreenshots(runId, details.steps, path.join(SHOTS_DIR, runId)).catch(() => []) : [];
  return { numSteps: details?.num_of_steps ?? undefined, videoUrl: details?.video_url ?? undefined, shots };
}

/** Independent verdict, checked against the final screenshot so an agent's wrong report can't pass a broken page. */
async function judge(run: Run, tc: TestCase, runId: string, details: Details, obs: ReturnType<typeof asObservation>, extra: string) {
  update(run, tc.id, { status: "verifying", observation: obs });
  const ev = evidence(runId, details);
  try {
    const last = (await ev).shots.at(-1);
    const finalShot = last ? await readFile(path.join(SHOTS_DIR, runId, `${last.id}.jpg`)).catch(() => undefined) : undefined;
    const v = await verify(tc, obs, extra, finalShot);
    finish(run, tc.id, {
      verdict: v.verdict,
      reason: v.reason,
      expectedText: v.expected,
      observedText: v.observed,
      reproSteps: v.repro_steps,
      likelyCause: v.likely_cause ?? undefined,
      checkedScreenshot: v.checkedScreenshot,
      ...(await ev),
    });
  } catch (err) {
    finish(run, tc.id, { verdict: "ERROR", reason: `Verifier failed: ${(err as Error).message}`, ...(await ev) });
  }
}

function finish(run: Run, caseId: string, patch: Partial<TestResult>) {
  update(run, caseId, { ...patch, status: "done", finishedAt: new Date().toISOString() });
}

function cancelled(run: Run, caseId: string) {
  update(run, caseId, { status: "cancelled", reason: "Stopped by the tester", finishedAt: new Date().toISOString() });
}
