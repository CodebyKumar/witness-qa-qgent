"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import type { Severity, TestCase } from "@/lib/types";

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
    label: "Demo shop (seeded bugs)",
    url: process.env.NEXT_PUBLIC_DEMO_URL ?? "",
    checklist: "Sign up with a new account\nAdd two items to the cart and check the total\nApply coupon SAVE10 and check the 10% discount\nOpen the shipping policy from the footer",
  },
  {
    label: "SauceDemo (real third-party site)",
    url: "https://www.saucedemo.com",
    checklist:
      "Log in as standard_user with password secret_sauce and check the products page shows\nLog in as problem_user with password secret_sauce, sort products by Price (low to high) and check the cheapest item is first\nLog in as standard_user with a wrong password and check an error is shown",
  },
].filter((s) => s.url);

type Plan = { url: string; pageTitle: string; linkCount: number; cases: TestCase[] };

export default function NewRun() {
  const router = useRouter();
  const [url, setUrl] = useState("");
  const [checklist, setChecklist] = useState("");
  const [authorized, setAuthorized] = useState(false);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [busy, setBusy] = useState<"" | "planning" | "starting">("");
  const [error, setError] = useState("");

  async function post<T>(path: string, body: unknown): Promise<T | null> {
    setError("");
    const res = await fetch(path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({ error: `Server error ${res.status}` }));
    if (!res.ok) {
      setError(data.error ?? `Server error ${res.status}`);
      return null;
    }
    return data as T;
  }

  async function planTests(e: React.FormEvent) {
    e.preventDefault();
    setBusy("planning");
    const p = await post<Plan>("/api/plan", { url, checklist });
    setBusy("");
    if (p) setPlan(p);
  }

  async function startRun() {
    if (!plan) return;
    setBusy("starting");
    const r = await post<{ id: string }>("/api/runs", { url: plan.url, cases: plan.cases, authorized });
    if (r) router.push(`/runs/${r.id}`);
    else setBusy("");
  }

  const edit = (id: string, patch: Partial<TestCase>) =>
    setPlan((p) => p && { ...p, cases: p.cases.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const remove = (id: string) => setPlan((p) => p && { ...p, cases: p.cases.filter((c) => c.id !== id) });
  const add = () =>
    setPlan((p) => p && { ...p, cases: [...p.cases, { id: `tc-new-${Date.now()}`, title: "", steps: [""], expected: "", severity: "medium", destructive: false }] });

  const destructive = plan?.cases.filter((c) => c.destructive && c.allowSubmit).length ?? 0;

  return (
    <>
      <section className="intro" aria-labelledby="intro-head">
        <div>
          <h1 id="intro-head">Test any live website in plain English</h1>
          <p className="lead">Write what a tester would check. TinyFish agents run each case in a real browser and a separate verifier decides pass or fail.</p>
        </div>
        <ol className="route" aria-label="How a run works">
          <li className="plate">
            <span className="plate__figure">1</span>
            <strong>Plan</strong>
            <span>TinyFish Fetch reads the site. Your checklist becomes test cases you review.</span>
          </li>
          <li className="plate">
            <span className="plate__figure">2</span>
            <strong>Execute</strong>
            <span>Each case runs as a TinyFish agent in its own browser, live.</span>
          </li>
          <li className="plate">
            <span className="plate__figure">3</span>
            <strong>Judge</strong>
            <span>An independent verifier compares expected with observed and writes repro steps.</span>
          </li>
        </ol>
      </section>

      <form className="panel" onSubmit={planTests} aria-labelledby="setup-head">
        <h2 id="setup-head">1. What to test</h2>
        <div className="field">
          <label htmlFor="url">Target URL</label>
          <input id="url" name="url" type="url" inputMode="url" autoComplete="url" required placeholder="https://staging.yoursite.com" value={url} onChange={(e) => setUrl(e.target.value)} />
          <small>Public sites only. Use a staging site when the checklist places orders or deletes data.</small>
        </div>

        <div className="field">
          <label htmlFor="checklist">Checklist, one check per line</label>
          <textarea id="checklist" name="checklist" required rows={6} placeholder={"Sign up with a new account\nAdd two items to the cart and check the total\nApply coupon SAVE10"} value={checklist} onChange={(e) => setChecklist(e.target.value)} />
          <div className="cells" role="group" aria-label="Add a template">
            {Object.entries(TEMPLATES).map(([name, text]) => (
              <button key={name} type="button" className="cell" onClick={() => setChecklist((c) => (c.trim() ? `${c.trim()}\n${text}` : text))}>
                + {name}
              </button>
            ))}
          </div>
        </div>

        {SAMPLES.length > 0 && (
          <div className="field">
            <span className="field__label">Or load a sample</span>
            <div className="cells" role="group" aria-label="Load a sample">
              {SAMPLES.map((s) => (
                <button key={s.label} type="button" className="cell" onClick={() => (setUrl(s.url), setChecklist(s.checklist))}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        )}

        <label className="check">
          <input type="checkbox" checked={authorized} onChange={(e) => setAuthorized(e.target.checked)} required />
          <span>I own this site or have permission to test it</span>
        </label>

        <div className="actions">
          <button type="submit" className="btn btn--primary" disabled={busy !== ""}>
            {busy === "planning" ? "Reading the site and planning..." : plan ? "Plan again" : "Plan test cases"}
          </button>
        </div>
        {error && !plan && <p className="alert" role="alert">{error}</p>}
      </form>

      {busy === "planning" && !plan && (
        <section className="panel" aria-busy="true" aria-label="Planning">
          <div className="skeleton" />
          <div className="skeleton" />
          <div className="skeleton" />
        </section>
      )}

      {plan && (
        <section className="panel" aria-labelledby="review-head">
          <div className="panel__head">
            <h2 id="review-head">2. Review {plan.cases.length} test cases</h2>
            <p className="muted">
              TinyFish Fetch read <strong>{plan.pageTitle || plan.url}</strong> and found {plan.linkCount} links. Edit anything before it runs.
            </p>
          </div>

          {destructive > 0 && (
            <p className="alert alert--warn" role="status">
              {destructive} case{destructive > 1 ? "s" : ""} will really place an order, pay or delete data. Point the URL at staging, or untick &quot;Allow final submit&quot;.
            </p>
          )}

          <ol className="cases">
            {plan.cases.map((c, i) => (
              <li key={c.id} className="case">
                <div className="case__id num">TC-{String(i + 1).padStart(2, "0")}</div>
                <div className="case__body">
                  <label className="visually-hidden" htmlFor={`${c.id}-title`}>Title</label>
                  <input id={`${c.id}-title`} className="case__title" value={c.title} placeholder="Test case title" onChange={(e) => edit(c.id, { title: e.target.value })} />
                  <div className="case__grid">
                    <div className="field">
                      <label htmlFor={`${c.id}-steps`}>Steps, one per line</label>
                      <textarea id={`${c.id}-steps`} rows={Math.max(3, c.steps.length)} value={c.steps.join("\n")} onChange={(e) => edit(c.id, { steps: e.target.value.split("\n") })} />
                    </div>
                    <div className="field">
                      <label htmlFor={`${c.id}-expected`}>Expected result</label>
                      <textarea id={`${c.id}-expected`} rows={3} value={c.expected} onChange={(e) => edit(c.id, { expected: e.target.value })} />
                      {c.testData && <small>Test data: {c.testData}</small>}
                    </div>
                  </div>
                  {c.clarification && (
                    <p className="note">
                      <strong>Planner assumption:</strong> {c.clarification}
                    </p>
                  )}
                  <div className="case__meta">
                    <label>
                      Severity{" "}
                      <select value={c.severity} onChange={(e) => edit(c.id, { severity: e.target.value as Severity })}>
                        <option value="critical">critical</option>
                        <option value="high">high</option>
                        <option value="medium">medium</option>
                        <option value="low">low</option>
                      </select>
                    </label>
                    {c.destructive && <span className="tag tag--warn">Destructive</span>}
                    {c.autoAdded && <span className="tag">Negative case, added by planner</span>}
                    {c.destructive && (
                      <label className="check check--inline">
                        <input type="checkbox" checked={!!c.allowSubmit} onChange={(e) => edit(c.id, { allowSubmit: e.target.checked })} />
                        <span>Allow final submit</span>
                      </label>
                    )}
                    <button type="button" className="link-btn" onClick={() => remove(c.id)}>
                      Delete
                    </button>
                  </div>
                </div>
              </li>
            ))}
          </ol>

          <div className="actions">
            <button type="button" className="btn" onClick={add}>
              Add test case
            </button>
            <button type="button" className="btn btn--primary" onClick={startRun} disabled={busy !== "" || !plan.cases.length || !authorized}>
              {busy === "starting" ? "Starting..." : `Run ${plan.cases.length} tests on TinyFish`}
            </button>
          </div>
          {!authorized && <small>Tick the permission box above to run.</small>}
          {error && <p className="alert" role="alert">{error}</p>}
        </section>
      )}
    </>
  );
}
