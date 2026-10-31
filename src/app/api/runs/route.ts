import { startRun } from "@/lib/runs";
import type { TestCase } from "@/lib/types";

export async function POST(req: Request) {
  const { url, cases, authorized } = (await req.json()) as { url?: string; cases?: TestCase[]; authorized?: boolean };
  if (!authorized) return Response.json({ error: "Confirm you are allowed to test this site" }, { status: 400 });
  if (!url || !/^https?:\/\//.test(url)) return Response.json({ error: "Missing target URL" }, { status: 400 });
  const valid = (cases ?? []).filter((c) => c.title?.trim() && c.steps?.some((s) => s.trim()) && c.expected?.trim());
  if (!valid.length) return Response.json({ error: "Add at least one complete test case" }, { status: 400 });
  // Rate limit: cap the cases per run so one click can't burn the wallet.
  const capped = valid.slice(0, 12).map((c, i) => ({ ...c, id: `tc-${i + 1}`, steps: c.steps.filter((s) => s.trim()).slice(0, 12) }));

  const id = `run-${Date.now().toString(36)}`;
  await startRun(id, url, capped);
  return Response.json({ id });
}
