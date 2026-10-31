"use client";

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { Run, TestCase, TestResult, Verdict } from "@/lib/types";

const SEV_RANK = { critical: 0, high: 1, medium: 2, low: 3 } as const;
const VERDICT_RANK: Record<string, number> = { FAIL: 0, ERROR: 1, BLOCKED: 2, PASS: 3 };
const tcLabel = (run: Run, id: string) => `TC-${String(run.cases.findIndex((c) => c.id === id) + 1).padStart(2, "0")}`;

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
  const [selected, setSelected] = useState<string>("");
  const [, tick] = useState(0);

  useEffect(() => {
    const es = new EventSource(`/api/runs/${id}/events`);
    es.addEventListener("run", (e) => setRun(JSON.parse((e as MessageEvent).data)));
    es.addEventListener("result", (e) => {
      const r = JSON.parse((e as MessageEvent).data) as TestResult;
      setRun((prev) => prev && { ...prev, results: { ...prev.results, [r.caseId]: r } });
    });
    es.onerror = () => {
      if (es.readyState === EventSource.CLOSED) setMissing(true);
    };
    const t = setInterval(() => tick((n) => n + 1), 1000); // live elapsed times
    return () => (es.close(), clearInterval(t));
  }, [id]);

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
  const done = results.filter((r) => r.status === "done");
  const count = (v: Verdict) => done.filter((r) => r.verdict === v).length;
  const finished = done.length === results.length;
  const judged = count("PASS") + count("FAIL");
  const passRate = judged ? Math.round((count("PASS") / judged) * 100) : null;
  const criticalFails = run.cases.filter((c) => run.results[c.id].verdict === "FAIL" && (c.severity === "critical" || c.severity === "high")).length;

  const ordered = finished
    ? [...run.cases].sort(
        (a, b) =>
          VERDICT_RANK[run.results[a.id].verdict ?? "PASS"] - VERDICT_RANK[run.results[b.id].verdict ?? "PASS"] || SEV_RANK[a.severity] - SEV_RANK[b.severity],
      )
    : run.cases;

  const live = results.find((r) => r.status === "running" && r.streamingUrl);
  const focusId = selected || (finished ? ordered[0].id : live?.caseId ?? run.cases[0].id);
  const focusCase = run.cases.find((c) => c.id === focusId)!;
  const focus = run.results[focusId];
  const browser = focus.status === "running" && focus.streamingUrl ? focus : live;

  async function rerun() {
    if (!run) return;
    const res = await fetch("/api/runs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: run.url, cases: run.cases, authorized: true }) });
    const data = await res.json();
    if (res.ok) router.push(`/runs/${data.id}`);
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
        <div>
          <h1 id="run-title">{new URL(run.url).host}</h1>
          <p className="muted">
            <a href={run.url} target="_blank" rel="noreferrer">{run.url}</a>, started {new Date(run.createdAt).toLocaleString()}, run {run.id}
          </p>
        </div>
        <div className="actions no-print">
          <button type="button" className="btn" onClick={downloadJson}>Download JSON</button>
          <button type="button" className="btn" onClick={() => window.print()} disabled={!finished}>Save as PDF</button>
          <button type="button" className="btn btn--primary" onClick={rerun} disabled={!finished}>Run again</button>
        </div>
      </section>

      <section className="summary" aria-label="Summary">
        <div className="plate plate--figure">
          <span className="plate__label">{finished ? "Pass rate" : "Progress"}</span>
          <span className="plate__big num">{finished ? (passRate === null ? "n/a" : `${passRate}%`) : `${done.length}/${results.length}`}</span>
          <span>{finished ? `${count("PASS")} of ${judged} judged tests passed` : "tests finished"}</span>
        </div>
        <dl className="counts">
          <div><dt>Passed</dt><dd className="num v-pass">{count("PASS")}</dd></div>
          <div><dt>Failed</dt><dd className="num v-fail">{count("FAIL")}</dd></div>
          <div><dt>Blocked</dt><dd className="num">{count("BLOCKED")}</dd></div>
          <div><dt>Errors</dt><dd className="num">{count("ERROR")}</dd></div>
          <div><dt>Remaining</dt><dd className="num">{results.length - done.length}</dd></div>
        </dl>
        {finished && (
          <p className="summary__line">
            {count("FAIL") === 0 ? "No bugs found in the tested flows." : `${count("FAIL")} bug${count("FAIL") > 1 ? "s" : ""} found, ${criticalFails} critical or high severity.`}
          </p>
        )}
      </section>

      <section aria-labelledby="board-head">
        <h2 id="board-head" className="visually-hidden">Test cases</h2>
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
              </tr>
            </thead>
            <tbody>
              {ordered.map((c) => {
                const r = run.results[c.id];
                const last = r.progress.at(-1)?.text;
                return (
                  <tr key={c.id} aria-selected={c.id === focusId} className={c.id === focusId ? "is-selected" : ""}>
                    <td className="num">{tcLabel(run, c.id)}</td>
                    <td>
                      <button type="button" className="row-btn" onClick={() => setSelected(c.id)}>{c.title}</button>
                      {r.status === "running" && last && <span className="row-live">{last}</span>}
                      {r.status === "done" && r.reason && <span className="row-sub">{r.reason}</span>}
                    </td>
                    <td><span className={`sev sev--${c.severity}`}>{c.severity}</span></td>
                    <td className={`status status--${r.status}`}>{r.status}</td>
                    <td>{r.verdict ? <span className={`verdict verdict--${r.verdict.toLowerCase()}`}>{r.verdict}</span> : ""}</td>
                    <td className="num">{r.numSteps ?? (r.progress.length || "")}</td>
                    <td className="num">{seconds(r)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className="split" aria-label="Selected test case">
        <CaseDetail run={run} tc={focusCase} r={focus} />
        <aside className="browser no-print" aria-label="Live browser">
          <div className="browser__head">
            <strong>Live browser</strong>
            <span className="muted">{browser ? `${tcLabel(run, browser.caseId)}, streamed by TinyFish` : "Shows the agent while a test runs"}</span>
          </div>
          {browser?.streamingUrl ? (
            <iframe key={browser.streamingUrl} src={browser.streamingUrl} title={`Live TinyFish browser for ${tcLabel(run, browser.caseId)}`} className="browser__frame" />
          ) : (
            <div className="browser__empty">
              {finished ? (focus.videoUrl ? <a href={focus.videoUrl} target="_blank" rel="noreferrer">Watch the recording of this test</a> : "All tests finished.") : "Waiting for a TinyFish browser to start..."}
            </div>
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

function CaseDetail({ run, tc, r }: { run: Run; tc: TestCase; r: TestResult }) {
  return (
    <article className="detail">
      <header className="detail__head">
        <h3>
          {tcLabel(run, tc.id)} {tc.title}
        </h3>
        {r.verdict ? <span className={`verdict verdict--${r.verdict.toLowerCase()}`}>{r.verdict}</span> : <span className={`status status--${r.status}`}>{r.status}</span>}
      </header>
      {r.reason && <p className="detail__reason">{r.reason}</p>}

      <dl className="kv">
        <div><dt>Expected</dt><dd>{r.expectedText || tc.expected}</dd></div>
        {r.observedText && <div><dt>Observed</dt><dd>{r.observedText}</dd></div>}
        {r.likelyCause && <div><dt>Likely cause</dt><dd>{r.likelyCause}</dd></div>}
      </dl>

      {!!r.reproSteps?.length && (
        <>
          <h4>Steps to reproduce</h4>
          <ol className="steps">{r.reproSteps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </>
      )}

      {r.observation?.steps?.length ? (
        <>
          <h4>What the agent saw</h4>
          <div className="table-wrap">
            <table className="trace">
              <thead><tr><th scope="col" className="num">Step</th><th scope="col">Action</th><th scope="col">Observation</th><th scope="col">Done</th></tr></thead>
              <tbody>
                {r.observation.steps.map((s) => (
                  <tr key={s.step_number}>
                    <td className="num">{s.step_number}</td>
                    <td>{s.action}</td>
                    <td>{s.observation}</td>
                    <td>{s.completed ? "yes" : <strong className="v-fail">no</strong>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!r.observation.visible_errors?.length && <p className="note"><strong>Errors on the page:</strong> {r.observation.visible_errors.join("; ")}</p>}
          {r.observation.off_task_notes && <p className="note note--warn"><strong>Flagged:</strong> {r.observation.off_task_notes}</p>}
        </>
      ) : (
        <>
          <h4>Planned steps</h4>
          <ol className="steps">{tc.steps.map((s, i) => <li key={i}>{s}</li>)}</ol>
        </>
      )}

      {!!r.tfSteps?.length && r.tinyfishRunId && (
        <>
          <h4>Screenshots from TinyFish, last step first</h4>
          <ol className="shots">
            {[...r.tfSteps].reverse().map((s, i) => (
              <li key={s.id}>
                <figure>
                  <a href={`/api/shot?run=${r.tinyfishRunId}&step=${s.id}`} target="_blank" rel="noreferrer">
                    {/* eslint-disable-next-line @next/next/no-img-element -- proxied JPEG, no optimisation wanted */}
                    <img src={`/api/shot?run=${r.tinyfishRunId}&step=${s.id}`} alt="" width={1280} height={800} loading="lazy" />
                  </a>
                  <figcaption>
                    <span className="num">{r.tfSteps!.length - i}.</span> {s.action}
                  </figcaption>
                </figure>
              </li>
            ))}
          </ol>
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
      <p className="muted small">
        {r.tinyfishRunId ? `TinyFish run ${r.tinyfishRunId}` : "Not started"}
        {r.videoUrl && <>, <a href={r.videoUrl} target="_blank" rel="noreferrer">recording</a></>}
      </p>
    </article>
  );
}
