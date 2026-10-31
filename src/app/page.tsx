"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Severity, TestCase } from "@/lib/types";
import Select, { type Option } from "./select";

const TEMPLATES: Record<string, string> = {
  Login: "Log in with valid credentials and check the account page loads\nLog in with a wrong password and check an error message is shown",
  Signup: "Sign up for a new account with valid details\nSign up with an invalid email address and check it is rejected",
  Checkout: "Add two items to the cart and check the cart total is the sum of their prices\nApply a coupon code and check the total goes down\nGo to checkout and fill in shipping details, but do not place the order",
  "Contact form": "Submit the contact form with valid details and check a confirmation is shown\nSubmit the contact form with the email field empty",
  Navigation: "Open each link in the main navigation and check every page loads\nOpen the footer links and check none lead to an error page",
  Search: "Search for a product and check the results match the query\nSearch for random text and check a no-results message is shown",
};

const SAMPLES = [
  {
    label: "Demo shop: pass, fail, blocked",
    url: process.env.NEXT_PUBLIC_DEMO_URL ?? "",
    checklist:
      "Add the Enamel camp mug and the Canvas tote bag to the cart and check the cart total is $42.00\nWith those two items in the cart, apply coupon SAVE10 and check the total drops to $37.80\nSearch for \"bottle\" and check only the Steel water bottle is shown\nOpen Track order from the header and look up order FN-1042\nOpen the Shipping policy link in the footer and check the policy page loads",
  },
  {
    label: "SauceDemo, a real third-party site",
    url: "https://www.saucedemo.com",
    checklist:
      "Log in as standard_user with password secret_sauce and check the products page shows\nLog in as problem_user with password secret_sauce, sort products by Price (low to high) and check the cheapest item is first\nLog in as standard_user with a wrong password and check an error is shown",
  },
].filter((s) => s.url);

const SEVERITIES: Severity[] = ["critical", "high", "medium", "low"];
const SEVERITY_OPTIONS: Option<Severity>[] = [
  { value: "critical", label: "Critical", tone: "critical" },
  { value: "high", label: "High", tone: "high" },
  { value: "medium", label: "Medium", tone: "medium" },
  { value: "low", label: "Low", tone: "low" },
];

type Plan = { url: string; pageTitle: string; linkCount: number; pagesRead?: number; cases: TestCase[]; warning?: string };

async function post<T>(path: string, body: unknown): Promise<{ data?: T; error?: string }> {
  const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
  return res.ok ? { data } : { error: data.error ?? `Server error ${res.status}` };
}

export default function NewRun() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [checklist, setChecklist] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [more, setMore] = useState("");
  const [busy, setBusy] = useState<"" | "planning" | "more" | "starting">("");
  const [error, setError] = useState("");

  async function planTests(e: React.FormEvent) {
    e.preventDefault();
    setBusy("planning");
    setError("");
    const { data, error } = await post<Plan>("/api/plan", { url, checklist });
    setBusy("");
    if (data) setPlan(data);
    else setError(error!);
  }

  async function planMore() {
    if (!plan || !more.trim()) return;
    setBusy("more");
    setError("");
    const { data, error } = await post<Plan>("/api/plan", { url: plan.url, checklist: more, existing: plan.cases.map((c) => c.title) });
    setBusy("");
    if (data) {
      setPlan({ ...plan, cases: [...plan.cases, ...data.cases] });
      setMore("");
    } else setError(error!);
  }

  async function startRun() {
    if (!plan) return;
    const incomplete = plan.cases.findIndex((c) => !c.title.trim() || !c.steps.some((s) => s.trim()) || !c.expected.trim());
    if (incomplete >= 0) {
      setError(`TC-${String(incomplete + 1).padStart(2, "0")} needs a title, at least one step and an expected result.`);
      document.getElementById(`${plan.cases[incomplete].id}-title`)?.focus();
      return;
    }
    setBusy("starting");
    setError("");
    const { data, error } = await post<{ id: string }>("/api/runs", { url: plan.url, cases: plan.cases, authorized });
    if (data) router.push(`/runs/${data.id}`);
    else {
      setError(error!);
      setBusy("");
    }
  }

  const edit = (id: string, patch: Partial<TestCase>) => setPlan((p) => p && { ...p, cases: p.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: string) => setPlan((p) => p && { ...p, cases: p.cases.filter((c) => c.id !== id) });
  const add = () =>
    setPlan((p) => p && { ...p, cases: [...p.cases, { id: `manual-${Date.now()}`, title: "", steps: [""], expected: "", severity: "medium", destructive: false }] });

  const liveSubmits = plan?.cases.filter((c) => c.destructive && c.allowSubmit).length ?? 0;
  const bySeverity = SEVERITIES.map((s) => [s, plan?.cases.filter((c) => c.severity === s).length ?? 0] as const).filter(([, n]) => n);

  return (
    <>
      <section className="hero" aria-labelledby="intro-head">
        <div className="hero__copy">
          <span className="hero__badge">
            <span className="hero__badge-dot" aria-hidden="true" />
            Runs on TinyFish web agents
          </span>
          <h1 id="intro-head">
            Test any live website <span className="hero__soft">in plain English.</span>
          </h1>
          <p className="lead">Write what a tester would check. TinyFish agents run each case in a real browser, and a separate verifier decides pass or fail.</p>
          <ul className="hero__facts">
            <li>No test code</li>
            <li>Real cloud browsers</li>
            <li>Screenshot-checked verdicts</li>
          </ul>
        </div>

        <ol className="flow" aria-label="How a run works">
          <li className="flow__step">
            <span className="flow__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M8 6h11M8 12h11M8 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
            </span>
            <div className="flow__body">
              <strong>Plan</strong>
              <span className="flow__chip">checklist to test cases</span>
            </div>
          </li>
          <li className="flow__step">
            <span className="flow__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M10 13l4 2.5-4 2.5z" /></svg>
            </span>
            <div className="flow__body">
              <strong>Execute</strong>
              <span className="flow__chip flow__chip--live">live TinyFish browser</span>
            </div>
          </li>
          <li className="flow__step">
            <span className="flow__icon" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="18" height="18"><path d="M12 3l7 3v5c0 4.5-3 8-7 10-4-2-7-5.5-7-10V6z" /><path d="M8.5 12l2.5 2.5 4.5-5" /></svg>
            </span>
            <div className="flow__body">
              <strong>Judge</strong>
              <span className="flow__verdicts">
                <span className="verdict verdict--pass">PASS</span>
                <span className="verdict verdict--fail">FAIL</span>
                <span className="verdict verdict--blocked">BLOCKED</span>
              </span>
            </div>
          </li>
        </ol>
      </section>

      <form className="panel setup" onSubmit={planTests} aria-labelledby="setup-head">
        <div className="panel__head">
          <h2 id="setup-head">1. What to test</h2>
        </div>
        <div className="setup__grid">
          <div className="setup__main">
            <div className="field">
              <label htmlFor="url">Target URL</label>
              <input id="url" name="url" type="url" inputMode="url" autoComplete="url" required placeholder="https://staging.yoursite.com" value={url} onChange={(e) => setUrl(e.target.value)} />
              <small>Public sites only. Use a staging site when the checklist places orders or deletes data.</small>
            </div>
            <div className="field">
              <label htmlFor="checklist">Checklist</label>
              <textarea id="checklist" name="checklist" required rows={7} placeholder={"One check per line, or write it as a paragraph.\nSign up with a new account\nAdd two items to the cart and check the total\nApply coupon SAVE10"} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
              <small>Each check becomes its own test case. Form checks also get an invalid-input case.</small>
            </div>
          </div>
          <div className="setup__side">
            <div className="field">
              <span className="field__label">Add a template</span>
              <div className="cells" role="group" aria-label="Add a template">
                {Object.entries(TEMPLATES).map(([name, text]) => (
                  <button key={name} type="button" className="cell" onClick={() => setChecklist((c) => (c.trim() ? `${c.trim()}\n${text}` : text))}>
                    {name}
                  </button>
                ))}
              </div>
            </div>
            {SAMPLES.length > 0 && (
              <div className="field">
                <span className="field__label">Or load a sample</span>
                <div className="stack">
                  {SAMPLES.map((s) => (
                    <button key={s.label} type="button" className="cell cell--block" onClick={() => (setUrl(s.url), setChecklist(s.checklist))}>
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="setup__foot">
          <label className="check">
            <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} required />
            <span>I own this site or have permission to test it</span>
          </label>
          <button type="submit" className="btn btn--primary" disabled={busy !== ""}>
            {busy === "planning" ? "Reading the site and planning..." : plan ? "Plan again from scratch" : "Plan test cases"}
          </button>
        </div>
        {error && !plan && <p className="alert" role="alert">{error}</p>}
      </form>

      {busy === "planning" && !plan && (
        <section className="panel" aria-busy="true" aria-label="Planning">
          <p className="muted">TinyFish Fetch is reading the site, then the planner writes test cases. This takes about 15 seconds.</p>
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </section>
      )}

      {plan && (
        <section className="panel review" aria-labelledby="review-head">
          <div className="review__head">
            <div className="panel__head">
              <h2 id="review-head">2. Review {plan.cases.length} test cases</h2>
              <p className="muted">
                TinyFish Fetch read {plan.pagesRead ?? 1} page{plan.pagesRead === 1 ? "" : "s"} of <strong>{plan.pageTitle || plan.url}</strong> to write these cases. Edit, delete or add cases before they run.
              </p>
            </div>
            {bySeverity.length > 0 && (
              <dl className="sevcount" aria-label="Cases by severity">
                {bySeverity.map(([s, n]) => (
                  <div key={s}>
                    <dt>{s}</dt>
                    <dd className="num">{n}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>

          {plan.warning && <p className="alert alert--warn" role="status">{plan.warning}</p>}

          {liveSubmits > 0 && (
            <p className="alert alert--warn" role="status">
              {liveSubmits} case{liveSubmits > 1 ? "s" : ""} will really place an order, pay or delete data. Point the URL at staging, or untick &quot;Allow final submit&quot;.
            </p>
          )}

          <ol className="cases">
            {plan.cases.map((c, i) => (
              <li key={c.id} className="case">
                <div className="case__head">
                  <span className="case__id num">TC-{String(i + 1).padStart(2, "0")}</span>
                  <label className="visually-hidden" htmlFor={`${c.id}-title`}>Title of TC-{i + 1}</label>
                  <input id={`${c.id}-title`} className="case__title" value={c.title} placeholder="Test case title" onChange={(e) => edit(c.id, { title: e.target.value })} />
                  <Select label="Severity" value={c.severity} options={SEVERITY_OPTIONS} onChange={(v) => edit(c.id, { severity: v })} />
                  <button type="button" className="link-btn" onClick={() => remove(c.id)} aria-label={`Delete TC-${i + 1}`}>
                    Delete
                  </button>
                </div>
                <div className="case__grid">
                  <div className="field">
                    <label htmlFor={`${c.id}-steps`}>Steps, one per line</label>
                    <textarea id={`${c.id}-steps`} rows={Math.max(4, c.steps.length)} value={c.steps.join("\n")} onChange={(e) => edit(c.id, { steps: e.target.value.split("\n") })} />
                  </div>
                  <div className="field">
                    <label htmlFor={`${c.id}-expected`}>Expected result</label>
                    <textarea id={`${c.id}-expected`} rows={4} value={c.expected} onChange={(e) => edit(c.id, { expected: e.target.value })} />
                  </div>
                </div>
                {(c.testData || c.clarification || c.autoAdded || c.destructive) && (
                  <div className="case__meta">
                    {c.autoAdded && <span className="tag">Negative case, added by planner</span>}
                    {c.destructive && <span className="tag tag--warn">Destructive</span>}
                    {c.destructive && (
                      <label className="check check--inline">
                        <input type="checkbox" checked={!!c.allowSubmit} onChange={(e) => edit(c.id, { allowSubmit: e.target.checked })} />
                        <span>Allow final submit</span>
                      </label>
                    )}
                    {c.testData && <span className="muted">Test data: {c.testData}</span>}
                    {c.clarification && (
                      <p className="note">
                        <strong>Planner assumption:</strong> {c.clarification}
                      </p>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ol>

          <div className="more">
            <div className="field">
              <label htmlFor="more">Add more checks</label>
              <textarea id="more" rows={3} placeholder={"Check the footer links work\nSearch for a product that does not exist"} value={more} onChange={(e) => setMore(e.target.value)} />
              <small>Only the new checks are planned. Your edits above stay as they are.</small>
            </div>
            <div className="actions">
              <button type="button" className="btn" onClick={planMore} disabled={busy !== "" || !more.trim()}>
                {busy === "more" ? "Planning..." : "Plan these checks"}
              </button>
              <button type="button" className="btn" onClick={add}>
                Write a case by hand
              </button>
            </div>
          </div>

          {error && <p className="alert" role="alert">{error}</p>}
          <div className="runbar">
            <span>
              {plan.cases.length} test case{plan.cases.length === 1 ? "" : "s"} on <strong>{new URL(plan.url).host}</strong>
              {!authorized && <span className="muted">. Tick the permission box above to run.</span>}
            </span>
            <button type="button" className="btn btn--primary" onClick={startRun} disabled={busy !== "" || !plan.cases.length || !authorized}>
              {busy === "starting" ? "Starting..." : `Run ${plan.cases.length} tests on TinyFish`}
            </button>
          </div>
        </section>
      )}
    </>
  );
}
