import { z } from "zod";
import type { Observation, TestCase } from "./types";

// Groq (OpenAI-compatible). Models are tried in order; a rate limit or an unavailable model falls through to the next.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = (process.env.GROQ_MODELS ?? "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

class FallThrough extends Error {
  retryAfterS: number;
  constructor(msg: string, retryAfterS = 0) {
    super(msg);
    this.retryAfterS = retryAfterS;
  }
}

const VISION_MODEL = process.env.GROQ_VISION_MODEL ?? "qwen/qwen3.8-27b";

async function callGroq(model: string, system: string, user: string, maxTokens: number, image?: string): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    signal: AbortSignal.timeout(60_000),
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: image ? [{ type: "text", text: user }, { type: "image_url", image_url: { url: image } }] : user },
      ],
    }),
  }).catch((err: Error) => {
    throw new FallThrough(`${model}: ${err.name === "TimeoutError" ? "timed out after 60s" : err.message}`);
  });
  if (res.ok) {
    const data = (await res.json()) as { choices: { message: { content: string | null } }[] };
    return data.choices[0]?.message.content ?? "";
  }
  const body = await res.text();
  if (res.status === 401) throw new Error("Groq rejected the API key. Set GROQ_API_KEY in .env.local");
  // 429 rate limit, 5xx outage, 404 / model errors, or json_object validation failure: try the next model.
  if (res.status === 429 || res.status >= 500 || res.status === 404 || /model|json_validate_failed/i.test(body))
    throw new FallThrough(`${model}: ${res.status} ${body.slice(0, 200)}`, Number(res.headers.get("retry-after")) || 0);
  throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`);
}

// One LLM call at a time: parallel test verdicts would otherwise burst through Groq's per-minute token limit.
let queue: Promise<unknown> = Promise.resolve();
function askJson<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens: number, image?: string): Promise<T> {
  const next = queue.then(() => askJsonNow(system, user, schema, maxTokens, image));
  queue = next.catch(() => {});
  return next;
}

/** Ask for JSON, validate with zod. Walks the model chain on rate limits; one corrective retry on bad JSON. */
async function askJsonNow<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens: number, image?: string): Promise<T> {
  const models = image ? [VISION_MODEL] : MODELS;
  const sys = system + "\nRespond with one JSON object only. No prose, no code fences.";
  let prompt = user;
  const misses: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = "";
    for (let round = 0; round < 3 && !text; round++) {
      let wait = 0;
      for (const model of models) {
        try {
          text = await callGroq(model, sys, prompt, maxTokens, image);
          break;
        } catch (err) {
          if (!(err instanceof FallThrough)) throw err;
          misses.push(err.message);
          wait = Math.max(wait, err.retryAfterS);
        }
      }
      // Every model rate limited: per-minute limits reset quickly, so wait as Groq asks (5 to 30s) and go round again.
      if (!text && round < 2) await new Promise((r) => setTimeout(r, Math.min(30, Math.max(5, wait || 15)) * 1000));
    }
    if (!text) throw new Error(`All Groq models are rate limited or unavailable. ${misses.at(-1) ?? ""}`);
    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, "");
    try {
      return schema.parse(JSON.parse(clean.slice(clean.indexOf("{"), clean.lastIndexOf("}") + 1)));
    } catch (err) {
      prompt = `${user}\n\nYour previous reply was invalid (${String(err).slice(0, 400)}). Return valid JSON only.`;
    }
  }
  throw new Error("The LLM did not return valid JSON twice in a row");
}

const planSchema = z.object({
  cases: z.array(
    z.object({
      title: z.string(),
      steps: z.array(z.string()).min(1),
      expected: z.string(),
      severity: z.enum(["critical", "high", "medium", "low"]),
      destructive: z.boolean(),
      autoAdded: z.boolean().nullish(),
      testData: z.string().nullish(),
      clarification: z.string().nullish(),
    }),
  ),
});

export async function planTests(
  url: string,
  page: { title: string; text: string; links: string[] },
  checklist: string,
  runTag: string,
  existing: string[] = [],
): Promise<Omit<TestCase, "id">[]> {
  const { cases } = await askJson(
    `You are a senior QA engineer writing manual test cases for a browser agent that follows steps literally.
Rules:
- The checklist may be one check per line or free text. Split it into distinct checks and write one test case per check, in the order given. A line that asks for several separate checks becomes several cases.
- Each case is one flow of 3 to 8 short imperative steps, starting from the given URL. Include login steps in every case that needs a logged-in state, because each case runs in a fresh browser.
- Name real UI from the page snapshot (button labels, link text, form fields). If the element isn't in the snapshot, describe it visually ("the cart icon in the header").
- "expected" is concrete and checkable: exact messages, totals, URLs or visible state. Never "works correctly".
- severity: critical (blocks purchase, signup or login), high (core feature wrong), medium (secondary feature), low (cosmetic or content).
- destructive: true if any step places an order, pays, deletes, or sends a real message.
- For a line that tests a form, add ONE extra negative case right after it (invalid input, expect a validation error), with autoAdded: true.
- testData: unique values when a form needs them, e.g. "Name: Test User, Email: qa+${runTag}@example.com, Password: Qa!${runTag}x9".
- Write at most 15 cases in total.
- If a line is too vague to write a checkable expected result, still write your best case and put one short question in "clarification" stating your assumption.
Return {"cases":[{"title","steps","expected","severity","destructive","autoAdded"?,"testData"?,"clarification"?}]}.`,
    `URL: ${url}
Page title: ${page.title}
Page snapshot (markdown, truncated):
${page.text}

Links on the page:
${page.links.join("\n")}

${existing.length ? `These test cases already exist. Do not repeat them; write cases only for the new checks:\n${existing.map((t) => `- ${t}`).join("\n")}\n\n` : ""}Checklist:
${checklist}`,
    planSchema,
    3000,
  );
  // The model may send null for optional fields; keep the TestCase shape clean.
  return cases.slice(0, 15).map((c) => ({
    ...c,
    autoAdded: c.autoAdded ?? undefined,
    testData: c.testData ?? undefined,
    clarification: c.clarification ?? undefined,
  }));
}

const verdictSchema = z.object({
  verdict: z.enum(["PASS", "FAIL", "BLOCKED"]),
  reason: z.string(),
  expected: z.string(),
  observed: z.string(),
  repro_steps: z.array(z.string()),
  likely_cause: z.string().nullish(),
});

const VERIFY_RULES = `You are an independent QA verifier. A browser agent executed a test case and reported observations. You decide the verdict. The agent did not judge, and you must not trust any claim of success that is not backed by evidence.
- PASS: every step completed and the evidence shows the expected result. Missing or vague evidence is never PASS.
- FAIL: the site behaved differently from the expected result, or a step could not be done because the site is broken (missing element, error, no change, wrong value). Compare exact values: if a discount should change a total, check the numbers.
- If the run was stopped at the time limit, judge from the activity log: the same action attempted again and again without the expected effect means that step does not work (FAIL), unless the log shows a cause outside the site (BLOCKED).
- BLOCKED: the test could not be performed for reasons outside the site under test (captcha, bot protection, login wall without credentials, site down).
- reason: one sentence a developer understands. expected / observed: one short line each, quoting values.
- repro_steps: for FAIL, steps a developer can follow to see the bug, ending with the wrong result, without numbering. For PASS or BLOCKED, an empty array.
- likely_cause: for FAIL, one sentence on the probable cause in the code. Omit otherwise.
Return {"verdict","reason","expected","observed","repro_steps","likely_cause"?}.`;

const SCREENSHOT_RULE = `
- The attached image is the browser's final screenshot and is the ground truth. Read it yourself: selected options, list order, prices, messages. If the agent's observations contradict the screenshot, trust the screenshot, judge from it, and say in "reason" that the agent's report did not match the screen.`;

/** Verdict from the agent's observations, checked against the final screenshot when there is one. */
export async function verify(tc: TestCase, obs: Observation | null, agentText: string, finalShot?: Buffer) {
  const user = `Test case: ${tc.title}
Steps:
${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Expected: ${tc.expected}

Agent observations (JSON):
${obs ? JSON.stringify(obs, null, 2) : "(no structured observation)"}
${agentText ? `\nAdditional run information:\n${agentText.slice(0, 3000)}` : ""}`;
  if (finalShot) {
    try {
      const v = await askJson(VERIFY_RULES + SCREENSHOT_RULE, user, verdictSchema, 1500, `data:image/jpeg;base64,${finalShot.toString("base64")}`);
      return { ...v, checkedScreenshot: true };
    } catch {
      // Vision model limited or unavailable: fall back to judging the observations alone.
    }
  }
  return { ...(await askJson(VERIFY_RULES, user, verdictSchema, 1200)), checkedScreenshot: false };
}
