import { randomBytes } from "node:crypto";
import { getRun, listRuns, startRun, summarize } from "@/lib/runs";
import type { TestCase } from "@/lib/types";

const MAX_CASES = 20; // cap per run so one click can't burn the wallet

export async function POST(req: Request) {
  const body = (await req.json()) as { url?: string; cases?: TestCase[]; authorized?: boolean; fromRun?: string };
  let { url, cases } = body;

  // "Run all again" reuses a run that was already authorized, so the permission check stays on the server.
  if (body.fromRun) {
    const prev = await getRun(body.fromRun);
    if (!prev) return Response.json({ error: "The original run was not found" }, { status: 404 });
    ({ url, cases } = prev);
  } else if (!body.authorized) {
    return Response.json({ error: "Confirm you are allowed to test this site" }, { status: 400 });
  }
  if (!url || !/^https?:\/\//.test(url)) return Response.json({ error: "Missing target URL" }, { status: 400 });
  if (!cases?.length) return Response.json({ error: "Add at least one test case" }, { status: 400 });
  if (cases.length > MAX_CASES) return Response.json({ error: `A run can have at most ${MAX_CASES} test cases` }, { status: 400 });

  const incomplete = cases.map((c, i) => (c.title?.trim() && c.steps?.some((s) => s.trim()) && c.expected?.trim() ? 0 : i + 1)).filter(Boolean);
  if (incomplete.length)
    return Response.json({ error: `${incomplete.map((n) => `TC-${String(n).padStart(2, "0")}`).join(", ")} need a title, at least one step and an expected result` }, { status: 400 });

  const clean = cases.map((c, i) => ({ ...c, id: `tc-${i + 1}`, steps: c.steps.filter((s) => s.trim()).slice(0, 12) }));
  const id = `run-${Date.now().toString(36)}-${randomBytes(4).toString("hex")}`;
  await startRun(id, url, clean);
  return Response.json({ id });
}

export async function GET() {
  return Response.json((await listRuns()).slice(0, 50).map(summarize));
}
