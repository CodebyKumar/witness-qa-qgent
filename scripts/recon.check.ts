// Self-check: page picking for the planner, and the token ceiling on planner prompts.
import assert from "node:assert/strict";
import { pickPages } from "../src/lib/tinyfish.ts";

const start = "https://shop.example.com/";
const links = [
  "https://shop.example.com/index.html",
  "https://shop.example.com/about.html",
  "https://shop.example.com/cart.html",
  "https://shop.example.com/about.html#contact",
  "https://other.example.org/cart.html",
  "https://shop.example.com/brochure.pdf",
  "https://shop.example.com/signup.html",
  "https://shop.example.com/track.html",
];
const picked = pickPages(start, links, "Apply coupon in the cart and track an order", 3);
assert.equal(picked[0], "https://shop.example.com/cart.html", "checklist words rank cart first");
assert.equal(picked[1], "https://shop.example.com/track.html", "then track");
assert.ok(!picked.some((u) => u.includes("other.example.org") || u.endsWith(".pdf") || u.endsWith("index.html")), "same site, no files, no start page");
assert.equal(new Set(picked).size, picked.length, "no duplicates (about.html#contact is about.html)");

// Planner prompt must stay under the ceiling even with a huge snapshot.
process.env.GROQ_MODELS = "m";
let sent = 0;
globalThis.fetch = (async (_u: string, init: RequestInit) => {
  const body = JSON.parse(String(init.body));
  sent = (body.messages as { content: string }[]).reduce((n, m) => n + m.content.length, 0) / 3.5 + body.max_completion_tokens;
  return Response.json({ choices: [{ message: { content: JSON.stringify({ cases: [{ title: "t", steps: ["s"], expected: "e", severity: "low", destructive: false }] }) } }] });
}) as typeof fetch;
const { planTests } = await import("../src/lib/llm.ts");
await planTests("https://shop.example.com/", { title: "Shop", text: "x".repeat(200_000), links: [] }, "Check the cart", "tag");
assert.ok(sent <= 8000, `planner call estimated at ${Math.round(sent)} tokens, over the 8000 ceiling`);
console.log(`recon ok: picked ${picked.map((u) => new URL(u).pathname).join(", ")}; planner call about ${Math.round(sent)} of 8000 tokens`);
