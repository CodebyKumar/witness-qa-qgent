// Self-check: a 429 on the first Groq model must fall through to the next one.
import assert from "node:assert/strict";

process.env.GROQ_MODELS = "model-a,model-b";
const tried: string[] = [];
globalThis.fetch = (async (_url: string, init: RequestInit) => {
  const { model } = JSON.parse(String(init.body));
  tried.push(model);
  if (model === "model-a") return new Response("rate limited", { status: 429 });
  const content = JSON.stringify({ verdict: "FAIL", reason: "Total unchanged", expected: "$45.00", observed: "$50.00", repro_steps: ["Apply SAVE10"] });
  return Response.json({ choices: [{ message: { content } }] });
}) as typeof fetch;

const { verify } = await import("../src/lib/llm.ts");
const v = await verify({ id: "tc-1", title: "Coupon", steps: ["Apply SAVE10"], expected: "Total drops 10%", severity: "high", destructive: false }, null, "");
assert.equal(v.verdict, "FAIL");
assert.deepEqual(tried, ["model-a", "model-b"]);
console.log("llm fallback ok:", tried.join(" -> "));
