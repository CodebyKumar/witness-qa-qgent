import { z } from "zod";
import type { Observation, TestCase } from "./types";

// Groq (OpenAI-compatible). Models are tried in order; a rate limit or an unavailable model falls through to the next.
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const MODELS = (process.env.GROQ_MODELS ?? "openai/gpt-oss-120b,qwen/qwen3.8-27b,openai/gpt-oss-20b")
  .split(",")
  .map((m) => m.trim())
  .filter(Boolean);

class FallThrough extends Error {}

async function callGroq(model: string, system: string, user: string, maxTokens: number): Promise<string> {
  const res = await fetch(GROQ_URL, {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.GROQ_API_KEY ?? ""}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      max_completion_tokens: maxTokens,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });
  if (res.ok) {
    const data = (await res.json()) as { choices: { message: { content: string | null } }[] };
    return data.choices[0]?.message.content ?? "";
  }
  const body = await res.text();
  if (res.status === 401) throw new Error("Groq rejected the API key. Set GROQ_API_KEY in .env.local");
  // 429 rate limit, 5xx outage, 404 / model errors, or json_object validation failure: try the next model.
  if (res.status === 429 || res.status >= 500 || res.status === 404 || /model|json_validate_failed/i.test(body))
    throw new FallThrough(`${model}: ${res.status} ${body.slice(0, 200)}`);
  throw new Error(`Groq ${res.status}: ${body.slice(0, 300)}`);
}

/** Ask for JSON, validate with zod. Walks the model chain on rate limits; one corrective retry on bad JSON. */
async function askJson<T>(system: string, user: string, schema: z.ZodType<T>, maxTokens: number): Promise<T> {
  const sys = system + "\nRespond with one JSON object only. No prose, no code fences.";
  let prompt = user;
  const misses: string[] = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    let text = "";
    for (let round = 0; round < 2 && !text; round++) {
      for (const model of MODELS) {
        try {
          text = await callGroq(model, sys, prompt, maxTokens);
          break;
        } catch (err) {
          if (!(err instanceof FallThrough)) throw err;
          misses.push(err.message);
        }
      }
      // Every model rate limited: per-minute limits reset quickly, so wait once and go round again.
      if (!text && round === 0) await new Promise((r) => setTimeout(r, 15000));
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
      autoAdded: z.boolean().optional(),
      testData: z.string().optional(),
      clarification: z.string().optional(),
    }),
  ),
});

export async function planTests(url: string, page: { title: string; text: string; links: string[] }, checklist: string, runTag: string): Promise<TestCase[]> {
  const { cases } = await askJson(
    `You are a senior QA engineer writing manual test cases for a browser agent that follows steps literally.
Rules:
- One test case per checklist line, in order. Each case is one flow of 3 to 8 short imperative steps, starting from the given URL.
- Name real UI from the page snapshot (button labels, link text, form fields). If the element isn't in the snapshot, describe it visually ("the cart icon in the header").
- "expected" is concrete and checkable: exact messages, totals, URLs or visible state. Never "works correctly".
- severity: critical (blocks purchase, signup or login), high (core feature wrong), medium (secondary feature), low (cosmetic or content).
- destructive: true if any step places an order, pays, deletes, or sends a real message.
- For a line that tests a form, add ONE extra negative case right after it (invalid input, expect a validation error), with autoAdded: true.
- testData: unique values when a form needs them, e.g. "Name: Test User, Email: qa+${runTag}@example.com, Password: Qa!${runTag}x9".
- If a line is too vague to write a checkable expected result, still write your best case and put one short question in "clarification" stating your assumption.
Return {"cases":[{"title","steps","expected","severity","destructive","autoAdded"?,"testData"?,"clarification"?}]}.`,
    `URL: ${url}
Page title: ${page.title}
Page snapshot (markdown, truncated):
${page.text}

Links on the page:
${page.links.join("\n")}

Checklist:
${checklist}`,
    planSchema,
    3000,
  );
  return cases.map((c, i) => ({ ...c, id: `tc-${i + 1}` }));
}

const verdictSchema = z.object({
  verdict: z.enum(["PASS", "FAIL", "BLOCKED"]),
  reason: z.string(),
  expected: z.string(),
  observed: z.string(),
  repro_steps: z.array(z.string()),
  likely_cause: z.string().optional(),
});

export async function verify(tc: TestCase, obs: Observation | null, agentText: string) {
  return askJson(
    `You are an independent QA verifier. A browser agent executed a test case and reported observations. You decide the verdict. The agent did not judge, and you must not trust any claim of success that is not backed by an observation.
- PASS: every step completed and the observations show the expected result. Missing or vague evidence is never PASS.
- FAIL: the site behaved differently from the expected result, or a step could not be done because the site is broken (missing element, error, no change, wrong value). Compare exact values: if a discount should change a total, check the numbers.
- BLOCKED: the test could not be performed for reasons outside the site under test (captcha, bot protection, login wall without credentials, site down).
- reason: one sentence a developer understands. expected / observed: one short line each, quoting values.
- repro_steps: for FAIL, numbered steps a developer can follow to see the bug, ending with the wrong result. For PASS or BLOCKED, an empty array.
- likely_cause: for FAIL, one sentence on the probable cause in the code. Omit otherwise.
Return {"verdict","reason","expected","observed","repro_steps","likely_cause"?}.`,
    `Test case: ${tc.title}
Steps:
${tc.steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}
Expected: ${tc.expected}

Agent observations (JSON):
${obs ? JSON.stringify(obs, null, 2) : "(no structured observation)"}
${agentText ? `\nAgent raw output:\n${agentText.slice(0, 3000)}` : ""}`,
    verdictSchema,
    1200,
  );
}
