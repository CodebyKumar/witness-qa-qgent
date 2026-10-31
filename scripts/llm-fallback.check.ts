// Self-check: a Groq 429 on the first model falls through to the next; when every model is limited it waits and retries.
import assert from "node:assert/strict";

process.env.GROQ_MODELS = "model-a,model-b";
const tried: string[] = [];
let limitAll = 1; // first round: every model rate limited
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const { model } = JSON.parse(String(init.body));
  tried.push(model);
  if (model === "model-a" || limitAll > 0) {
    if (model === "model-b") limitAll--;
    return new Response("rate limited", { status: 429, headers: { "retry-after": "1" } });
  }
  const content = JSON.stringify({ verdict: "FAIL", reason: "Total unchanged", expected: "$45.00", observed: "$50.00", repro_steps: ["Apply SAVE10"] });
  return Response.json({ choices: [{ message: { content } }] });
}) as typeof fetch;

const { verify } = await import("../src/lib/llm.ts");
const tc = { id: "tc-1", title: "Coupon", steps: ["Apply SAVE10"], expected: "Total drops 10%", severity: "high" as const, destructive: false };
const v = await verify(tc, null, "");
assert.equal(v.verdict, "FAIL");
assert.deepEqual(tried, ["model-a", "model-b", "model-a", "model-b"]);
console.log("llm fallback ok:", tried.join(" -> "));
