import { planTests } from "@/lib/llm";
import { fetchPage } from "@/lib/tinyfish";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { url, checklist } = (await req.json()) as { url?: string; checklist?: string };
  let target: URL;
  try {
    target = new URL(url ?? "");
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    return Response.json({ error: "Enter a full public URL starting with https://" }, { status: 400 });
  }
  if (!checklist?.trim()) return Response.json({ error: "Write at least one thing to test" }, { status: 400 });

  try {
    const page = await fetchPage(target.href);
    const runTag = Date.now().toString(36);
    const cases = await planTests(target.href, page, checklist.trim().slice(0, 4000), runTag);
    return Response.json({ url: target.href, pageTitle: page.title, linkCount: page.links.length, cases, runTag });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
