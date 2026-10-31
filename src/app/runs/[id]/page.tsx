"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Run, RunControl, TestCase, TestResult, Verdict } from "@/lib/types";

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const VERDICT_RANK: Record<string, number> = { FAIL: 0, ERROR: 1, BLOCKED: 2, PASS: 3 };
const FILTERS = ["All", "FAIL", "PASS", "BLOCKED", "ERROR"] as const;
type Filter = (typeof FILTERS)[number];

const tcLabel = (run: Run, id: string) => `TC-${String(run.cases.findIndex((c) => c.id === id) + 1).padStart(2, "0")}`;
const stripNum = (s: string) => s.replace(/^\s*\d+[.)]\s*/, ""); // the LLM sometimes numbers its own steps

function seconds(r: TestResult) {
  if (!r.startedAt) return "";
  const end = r.finishedAt ? Date.parse(r.finishedAt) : Date.now();
  return `${Math.round((end - Date.parse(r.startedAt)) / 1000)}s`;
}

export default function RunBoard({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const [run, setRun] = useState<Run | null>(null);
  const [missing, setMissing] = useState(false);
  const [selected, setSelected] = useState("");
  const [filter, setFilter] = useState<Filter>("All");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [connection, setConnection] = useState(0); // bump to reopen the stream after a retry
  const [, tick] = useState(0);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`);
    es.addEventListener("run", (e) => setRun(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("result", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as TestResult;
      setRun((prev) => prev && { ...prev, results: { ...prev.results, [r.caseId]: r } });
    });
    es.addEventListener("control", (e) => {
      const control = JSON.parse((e as MessageEvent).data) as RunControl;
      setRun((prev) => prev && { ...prev, control });
    });
    es.addEventListener("end", () => es.close());
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setMissing(true);
    };
    const t = setInterval(() => tick((n) => n + 1), 1000); // live elapsed times
    return () => (es.close(), clearInterval(t));
  }, [id, connection]);

  if (missing && !run) return <p className="alert" role="alert">This run was not found. It may have been started on another machine.</p>;
  if (!run)
    return (
      <section aria-busy="true" aria-label="Loading run">
        <div className="skeleton skeleton--tall" />
        <div className="skeleton" />
        <div className="skeleton" />
      </section>
    );

  const results = run.cases.map((c) => run.results[c.id]);
  const active = results.some((r) => r.status === "queued" || r.status === "running" || r.status === "verifying");
  const done = results.filter((r) => r.status === "done" || r.status === "cancelled");
  const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
  const judged = count("PASS") + count("FAIL");
  const passRate = judged ? Math.round((count("PASS") / judged) * 100) : null;
  const seriousFails = run.cases.filter((c) => run.results[c.id].verdict === "FAIL" && (c.severity === "critical" || c.severity === "high")).length;
  const control: RunControl = active ? (run.control === "paused" ? "paused" : run.control === "stopped" ? "stopped" : "running") : "finished";

  const ordered = active
    ? run.cases
    : [...run.cases].sort(
        (a, b) =>
          (VERDICT_RANK[run.results[a.id].verdict ?? ""] ?? 4) - (VERDICT_RANK[run.results[b.id].verdict ?? ""] ?? 4) ||
          SEV_RANK[a.severity] - SEV_RANK[b.severity],
      );
  const visible = filter === "All" ? ordered : ordered.filter((c) => run.results[c.id].verdict === filter);

  const live = results.find((r) => r.status === "running" && r.streamingUrl);
  const focusId = selected || (active ? live?.caseId ?? run.cases[0].id : ordered[0].id);
  const focusCase = run.cases.find((c) => c.id === focusId)!;
  const focus = run.results[focusId];

  async function act(action: "pause" | "resume" | "stop" | "retry", caseId?: string) {
    setBusy(action + (caseId ?? ""));
    setError("");
    const res = await fetch(`/api/runs/${id}/control`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, caseId }) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data.error ?? "That action failed");
    else if (action === "retry") setConnection((n) => n + 1);
    setBusy("");
  }

  async function rerun() {
    setBusy("rerun");
    const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fromRun: run!.id }) });
    const data = await res.json().catch(() => ({}));
    if (res.ok) router.push(`/runs/${data.id}`);
    else {
      setError(data.error ?? "Could not start a new run");
      setBusy("");
    }
  }

  function downloadJson() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(run, null, 2)], { type: "application/json" }));
    a.download = `${run!.id}.json`;
    a.click();
  }

  return (
    <>
      <section className="run-head" aria-labelledby="run-title">
        <div className="run-head__title">
          <h1 id="run-title">{new URL(run.url).host}</h1>
          <p className="muted">
            <a href={run.url} target="_blank" rel="noreferrer">{run.url}</a>
            <span>Started {new Date(run.createdAt).toLocaleString()}</span>
            <span className="num">{run.id}</span>
          </p>
        </div>
        <div className="toolbar no-print" role="toolbar" aria-label="Run controls">
          <span className={`state state--${control}`} role="status">
            {control === "running" ? "Running" : control === "paused" ? "Paused, running tests finish" : control === "stopped" ? "Stopping" : "Finished"}
          </span>
          {control === "running" && (
            <button type="button" className="btn" onClick={() => act("pause")} disabled={!!busy}>Pause</button>
          )}
          {control === "paused" && (
            <button type="button" className="btn btn--primary" onClick={() => act("resume")} disabled={!!busy}>Resume</button>
          )}
          {(control === "running" || control === "paused") && (
            <button type="button" className="btn btn--danger" onClick={() => act("stop")} disabled={!!busy}>Stop run</button>
          )}
          {control === "finished" && (
            <>
              <button type="button" className="btn" onClick={downloadJson}>Download JSON</button>
              <button type="button" className="btn" onClick={() => window.print()}>Save as PDF</button>
              <button type="button" className="btn btn--primary" onClick={rerun} disabled={!!busy}>Run all again</button>
            </>
          )}
        </div>
      </section>
      {error && <p className="alert" role="alert">{error}</p>}

      <section className="summary" aria-label="Summary">
        <div className="plate plate--figure">
          <span className="plate__label">{active ? "Progress" : "Pass rate"}</span>
          <span className="plate__big num">{active ? `${done.length}/${results.length}` : passRate === null ? "n/a" : `${passRate}%`}</span>
          <span>
            {active ? "tests finished" : `${count("PASS")} of ${judged} judged tests passed`}
            {!active && judged < results.length && `, ${results.length - judged} not judged`}
          </span>
        </div>
        <dl className="counts">
          <div><dt>Passed</dt><dd className="num v-pass">{count("PASS")}</dd></div>
          <div><dt>Failed</dt><dd className="num v-fail">{count("FAIL")}</dd></div>
          <div><dt>Blocked</dt><dd className="num">{count("BLOCKED")}</dd></div>
          <div><dt>Errors</dt><dd className="num">{count("ERROR")}</dd></div>
          <div><dt>{active ? "Remaining" : "Stopped"}</dt><dd className="num">{active ? results.length - done.length : results.filter((r) => r.status === "cancelled").length}</dd></div>
        </dl>
        <p className="summary__line">
          {active
            ? `${results.filter((r) => r.status === "running" || r.status === "verifying").length} running on TinyFish, ${results.filter((r) => r.status === "queued").length} queued.`
            : judged === 0
              ? "No test could be judged. Check the blocked and error reasons below."
              : count("FAIL") === 0
              ? `No bugs found in the ${judged} judged flows.`
              : `${count("FAIL")} bug${count("FAIL") > 1 ? "s" : ""} found, ${seriousFails} of them critical or high severity.`}
        </p>
      </section>

      <section aria-labelledby="board-head" className="board-wrap">
        <div className="board-bar">
          <h2 id="board-head">Test cases</h2>
          <div className="tabs no-print" role="group" aria-label="Filter by verdict">
            {FILTERS.map((f) => {
              const n = f === "All" ? results.length : count(f);
              if (f !== "All" && n === 0) return null;
              return (
                <button key={f} type="button" className="tab" aria-pressed={filter === f} onClick={() => setFilter(f)}>
                  {f === "All" ? "All" : f.charAt(0) + f.slice(1).toLowerCase()} <span className="num">{n}</span>
                </button>
              );
            })}
          </div>
        </div>
        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th scope="col">ID</th>
                <th scope="col">Test case</th>
                <th scope="col">Severity</th>
                <th scope="col">Status</th>
                <th scope="col">Verdict</th>
                <th scope="col" className="num">Steps</th>
                <th scope="col" className="num">Time</th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {visible.map((c) => {
                const r = run.results[c.id];
                const last = r.progress.at(-1)?.text;
                return (
                  <tr key={c.id} className={c.id === focusId ? "is-selected" : ""}>
                    <td className="num id-cell">{tcLabel(run, c.id)}</td>
                    <td>
                      <button type="button" className="row-btn" aria-current={c.id === focusId} onClick={() => setSelected(c.id)}>{c.title}</button>
                      {r.status === "running" && last && <span className="row-live">{last}</span>}
                      {(r.status === "done" || r.status === "cancelled") && r.reason && <span className="row-sub">{r.reason}</span>}
                    </td>
                    <td><span className={`sev sev--${c.severity}`}>{c.severity}</span></td>
                    <td className={`status status--${r.status}`}>{r.status}</td>
                    <td>{r.verdict ? <span className={`verdict verdict--${r.verdict.toLowerCase()}`}>{r.verdict}</span> : <span className="muted">-</span>}</td>
                    <td className="num">{r.numSteps ?? (r.progress.length || "")}</td>
                    <td className="num">{seconds(r)}</td>
                    <td className="row-act no-print">
                      {(r.status === "done" || r.status === "cancelled") && (
                        <button type="button" className="link-btn" onClick={() => act("retry", c.id)} disabled={!!busy}>Retry</button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {visible.length === 0 && (
                <tr><td colSpan={8} className="muted">No test cases with this verdict.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="split" aria-label="Selected test case">
        <CaseDetail run={run} tc={focusCase} r={focus} />
        <aside className="viewer no-print" aria-label={focus.status === "running" ? "Live browser" : "Evidence"}>
          {focus.status === "running" || (active && !focus.shots?.length) ? (
            <LiveBrowser run={run} r={focus.status === "running" ? focus : live} />
          ) : (
            <Evidence key={`${focus.caseId}-${focus.shots?.length ?? 0}`} r={focus} />
          )}
        </aside>
      </section>

      <section className="print-only" aria-label="All findings">
        <h2>All test cases</h2>
        {ordered.map((c) => (
          <CaseDetail key={c.id} run={run} tc={c} r={run.results[c.id]} />
        ))}
      </section>
    </>
  );
}

function LiveBrowser({ run, r }: { run: Run; r?: TestResult }) {
  return (
    <>
      <div className="viewer__head">
        <strong>Live browser</strong>
        <span>{r ? `${tcLabel(run, r.caseId)}, streamed by TinyFish` : "Waiting for a TinyFish browser"}</span>
      </div>
      {r?.streamingUrl ? (
        <iframe key={r.streamingUrl} src={r.streamingUrl} title={`Live TinyFish browser for ${tcLabel(run, r.caseId)}`} className="viewer__frame" />
      ) : (
        <div className="viewer__empty">The browser appears here a few seconds after a test starts.</div>
      )}
    </>
  );
}

function Evidence({ r }: { r: TestResult }) {
  const shots = r.shots ?? [];
  const [i, setI] = useState(shots.length - 1); // the last frame is what the agent saw when it stopped
  const shot = shots.at(i);
  const src = (id: string) => `/api/shot?run=${r.tinyfishRunId}&step=${id}`;
  return (
    <>
      <div className="viewer__head">
        <strong>Evidence</strong>
        <span>{shots.length ? `Step ${i + 1} of ${shots.length}` : "No screenshots"}</span>
      </div>
      {shot ? (
        <>
          <a href={src(shot.id)} target="_blank" rel="noreferrer" className="viewer__shot">
            {/* eslint-disable-next-line @next/next/no-img-element -- local JPEG, no optimisation wanted */}
            <img src={src(shot.id)} alt={`Screenshot after: ${shot.action}`} width={1280} height={720} />
          </a>
          <p className="viewer__caption">{shot.action}</p>
          <ol className="filmstrip" aria-label="All step screenshots">
            {shots.map((s, n) => (
              <li key={s.id}>
                <button type="button" aria-pressed={n === i} aria-label={`Step ${n + 1}: ${s.action}`} onClick={() => setI(n)}>
                  {/* eslint-disable-next-line @next/next/no-img-element -- local JPEG thumbnail */}
                  <img src={src(s.id)} alt="" width={160} height={90} loading="lazy" />
                </button>
              </li>
            ))}
          </ol>
        </>
      ) : (
        <div className="viewer__empty">
          {r.status === "verifying" ? "Saving screenshots..." : r.videoUrl ? <a href={r.videoUrl} target="_blank" rel="noreferrer">Watch the recording</a> : "TinyFish returned no screenshots for this test."}
        </div>
      )}
    </>
  );
}

function CaseDetail({ run, tc, r }: { run: Run; tc: TestCase; r: TestResult }) {
  return (
    <article className="detail">
      <header className="detail__head">
        <div>
          <span className="muted num">{tcLabel(run, tc.id)}, {tc.severity} severity</span>
          <h3>{tc.title}</h3>
        </div>
        {r.verdict ? <span className={`verdict verdict--${r.verdict.toLowerCase()}`}>{r.verdict}</span> : <span className={`status status--${r.status}`}>{r.status}</span>}
      </header>
      {r.reason && <p className="detail__reason">{r.reason}</p>}
      {r.verdict && r.verdict !== "ERROR" && (
        <p className="muted small">{r.checkedScreenshot ? "Verified against the final screenshot." : "Verified from the agent's report only."}</p>
      )}

      <dl className="kv">
        <div><dt>Expected</dt><dd>{r.expectedText || tc.expected}</dd></div>
        {r.observedText && <div><dt>Observed</dt><dd>{r.observedText}</dd></div>}
        {r.likelyCause && <div><dt>Likely cause</dt><dd>{r.likelyCause}</dd></div>}
      </dl>

      {!!r.reproSteps?.length && (
        <>
          <h4>Steps to reproduce</h4>
          <ol className="steps">{r.reproSteps.map((s, i) => <li key={i}>{stripNum(s)}</li>)}</ol>
        </>
      )}

      {r.observation?.steps?.length ? (
        <>
          <h4>What the agent saw</h4>
          <ol className="trace">
            {r.observation.steps.map((s) => (
              <li key={s.step_number} className={s.completed ? "" : "trace__fail"}>
                <span className="trace__n num">{s.step_number}</span>
                <div>
                  <strong>{stripNum(s.action)}</strong>
                  <p>{s.observation}</p>
                </div>
                <span className="trace__done">{s.completed ? "done" : "not done"}</span>
              </li>
            ))}
          </ol>
          {!!r.observation.visible_errors?.length && <p className="note"><strong>Errors on the page:</strong> {r.observation.visible_errors.join("; ")}</p>}
          {r.observation.off_task_notes && <p className="note note--warn"><strong>Flagged:</strong> {r.observation.off_task_notes}</p>}
        </>
      ) : (
        <>
          <h4>Planned steps</h4>
          <ol className="steps">{tc.steps.map((s, i) => <li key={i}>{stripNum(s)}</li>)}</ol>
        </>
      )}

      {r.progress.length > 0 && (
        <details className="log">
          <summary>TinyFish activity log, {r.progress.length} events</summary>
          <ol>
            {r.progress.map((p, i) => (
              <li key={i}><span className="num muted">{new Date(p.at).toLocaleTimeString()}</span> {p.text}</li>
            ))}
          </ol>
        </details>
      )}
      {!!r.shots?.length && (
        <div className="print-only shots-print">
          {r.shots.slice(-3).map((s) => (
            // eslint-disable-next-line @next/next/no-img-element -- print copy of local evidence
            <img key={s.id} src={`/api/shot?run=${r.tinyfishRunId}&step=${s.id}`} alt={`Screenshot after: ${s.action}`} width={1280} height={720} />
          ))}
        </div>
      )}
      <p className="muted small">
        {r.tinyfishRunId ? `TinyFish run ${r.tinyfishRunId}` : "Not started"}
        {r.videoUrl && <>, <a href={r.videoUrl} target="_blank" rel="noreferrer">recording</a></>}
      </p>
    </article>
  );
}
