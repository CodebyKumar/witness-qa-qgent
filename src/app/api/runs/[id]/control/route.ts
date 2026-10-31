import { controlRun } from "@/lib/runs";

const ACTIONS = new Set(["pause", "resume", "stop", "retry"]);

export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { action, caseId } = (await req.json()) as { action?: string; caseId?: string };
  if (!action || !ACTIONS.has(action)) return Response.json({ error: "Unknown action" }, { status: 400 });
  const error = await controlRun(id, action as "pause" | "resume" | "stop" | "retry", caseId);
  return error ? Response.json({ error }, { status: 409 }) : Response.json({ ok: true });
}
