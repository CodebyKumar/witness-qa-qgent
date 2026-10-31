# Witness: QA agent on TinyFish

Describe what to test in plain English. TinyFish agents run each test case on the live site, and an independent LLM verifier gives PASS / FAIL / BLOCKED with evidence and repro steps. No login and no test code.

## Run it

```bash
npm install
cp .env.example .env.local   # then fill in TINYFISH_API_KEY and GROQ_API_KEY
npm run dev                  # http://localhost:3000
```

Run the app as a long-lived server (`npm run dev` or `npm run build && npm start`). Test runs stream for minutes, which doesn't fit serverless time limits.

## How TinyFish is used

| Stage | TinyFish API | What it does |
|---|---|---|
| Plan | Fetch (`client.fetch.getContents`) | Reads the target page and its links, so test steps name real buttons and fields |
| Execute | Agent SSE (`client.agent.stream`) | One QA-mode goal per test case, with `output_schema` for structured observations, run in parallel |
| Live view | `STREAMING_URL` event | The live browser is embedded in the run board |
| Evidence | `GET /v1/runs/{id}` + step screenshots | Step list and a screenshot per step, saved to `data/shots/` and served by `/api/shot` |

The agent only reports what it observed, and it is never shown the expected result, so it can't be primed to "see" it. A separate Groq call decides the verdict and checks it against the final screenshot with a vision model (`GROQ_VISION_MODEL`), so a wrong agent report can't pass a broken page (`src/lib/llm.ts`). Groq models are tried in the order given in `GROQ_MODELS`, and a rate limit falls through to the next model.

## Using it

- **Checklist:** one check per line, or a paragraph. Each distinct check becomes its own test case, and form checks also get an invalid-input case. After planning, **Add more checks** plans only the new lines and keeps your edits.
- **During a run:** **Pause** holds queued tests (running ones finish), **Resume** continues, and **Stop run** cancels the TinyFish runs and skips the queue. Each finished or stopped test has **Retry**.
- **Evidence:** every test stores its TinyFish step screenshots in `data/shots/`. The board shows the final frame large, with a filmstrip of every step.

## Demo site

`demo-site/` is a static shop with seeded bugs:
- coupon `SAVE10` shows a success message, but the total doesn't change
- signup accepts `abc` as an email
- the "Shipping policy" footer link returns 404
- "Remove" deletes the first cart item instead of the one clicked

TinyFish can't reach localhost, so deploy the folder publicly (for example `npx vercel demo-site --prod`, or drag it onto Netlify Drop). Then set `NEXT_PUBLIC_DEMO_URL` to that URL and restart the app. A "Demo shop" sample button will appear.

## Checks

- `npm run smoke`: one real TinyFish agent run against saucedemo.com (proves the key and SSE).
- `npm run check`: self-check that a Groq 429 falls through to the next model.

Runs are saved as JSON in `data/runs/` and listed at `/runs`.
