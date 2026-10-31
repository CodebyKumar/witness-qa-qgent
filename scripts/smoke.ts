// One real TinyFish run end to end: proves the key, SSE events and output_schema work.
import { TinyFish } from "@tiny-fish/sdk";

const client = new TinyFish();
const stream = await client.agent.stream({
  url: "https://www.saucedemo.com",
  goal: "Log in with username standard_user and password secret_sauce. Report the page heading you see after login and the number of products listed.",
  output_schema: {
    type: "object",
    properties: { heading: { type: "string" }, product_count: { type: "integer" }, logged_in: { type: "boolean" } },
    required: ["heading", "product_count", "logged_in"],
  },
  agent_config: { max_duration_seconds: 120 },
});
const t0 = Date.now();
for await (const e of stream) {
  if (e.type === "HEARTBEAT") continue;
  console.log(`${((Date.now() - t0) / 1000).toFixed(1)}s`, e.type, JSON.stringify(e).slice(0, 300));
}
