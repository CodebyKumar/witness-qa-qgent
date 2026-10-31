import { getRun, onRunUpdate } from "@/lib/runs";

export const dynamic = "force-dynamic";

/** SSE: one `run` snapshot, then a `result` event per test-case change. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return new Response("Run not found", { status: 404 });

  const enc = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      const send = (event: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      send("run", run);
      const unsub = onRunUpdate(id, (r) => send("result", r));
      const ping = setInterval(() => ctl.enqueue(enc.encode(": ping\n\n")), 15000);
      off = () => (clearInterval(ping), unsub());
      req.signal.addEventListener("abort", () => {
        off();
        ctl.close();
      });
    },
    cancel() {
      off();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
