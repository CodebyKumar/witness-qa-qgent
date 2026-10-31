import { planTests } from "@/lib/llm";
import { fetchPage } from "@/lib/tinyfish";

export const maxDuration = 300;

export async function POST(req: Request) {
  const { url, checklist, existing } = (await req.json()) as { url?: string; checklist?: string; existing?: string[] };
  let target: URL;
  try {
    target = new URL(url ?? "");
    if (!/^https?:$/.test(target.protocol)) throw new Error();
  } catch {
    return Response.json({ error: "Enter a full public URL starting with https://" }, { status: 400 });
  }
  if (!checklist?.trim()) return Response.json({ error: "Write at least one thing to test" }, { status: 400 });

  try {
    // A bot-blocked or script-only site shouldn't stop planning: fall back to the checklist alone.
    let warning = "";
    const page = await fetchPage(target.href).catch((err: Error) => {
      warning = `TinyFish Fetch could not read the page (${err.message}). Cases were planned from your checklist alone, so check the button names.`;
      return { title: "", text: "(The page could not be read. Describe elements by their likely visible label.)", links: [] as string[] };
    });
    const runTag = Date.now().toString(36);
    const titles = (existing ?? []).filter((t) => typeof t === "string").slice(0, 30);
    const cases = await planTests(target.href, page, checklist.trim().slice(0, 4000), runTag, titles);
    const stamp = Date.now().toString(36);
    return Response.json({
      url: target.href,
      pageTitle: page.title,
      linkCount: page.links.length,
      warning,
      cases: cases.map((c, i) => ({ ...c, id: `${stamp}-${i}` })),
    });
  } catch (err) {
    return Response.json({ error: (err as Error).message }, { status: 502 });
  }
}
