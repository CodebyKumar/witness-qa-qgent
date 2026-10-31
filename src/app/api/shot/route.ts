import { readFile } from "node:fs/promises";
import path from "node:path";
import { SHOTS_DIR } from "@/lib/runs";

/** Serve a step screenshot saved to disk when its test finished. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const run = q.get("run") ?? "",
    step = q.get("step") ?? "";
  if (!/^[\w-]{8,64}$/.test(run) || !/^[\w-]{8,64}$/.test(step)) return new Response("Bad ids", { status: 400 });
  try {
    const img = await readFile(path.join(SHOTS_DIR, run, `${step}.jpg`));
    return new Response(img, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=31536000, immutable" } });
  } catch {
    return new Response("Screenshot not found", { status: 404 });
  }
}
