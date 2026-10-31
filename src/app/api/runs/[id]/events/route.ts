import { getRun, isActive, onRunEvent } from "@/lib/runs";

export const dynamic = "force-dynamic";

/** SSE: one `run` snapshot, then `result` / `control` events. Closes once the run is no longer live. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const run = await getRun(id);
  if (!run) return new Response("Run not found", { status: 404 });

  const enc = new TextEncoder();
  let off = () => {};
  const stream = new ReadableStream({
    start(ctl) {
      const send = (event: string, data: unknown) => ctl.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
      const end = () => {
        off();
        send("end", {}); // tells the client to close, or EventSource would reconnect forever
        ctl.close();
      };
      send("run", run);
      if (!Object.values(run.results).some(isActive)) return end();
      const unsub = onRunEvent(id, (e) => {
        send(e.event, e.data);
        if (e.event === "control" && e.data === "finished") end();
      });
      const ping = setInterval(() => ctl.enqueue(enc.encode(": ping\n\n")), 15000);
      off = () => (clearInterval(ping), unsub());
      req.signal.addEventListener("abort", () => off());
    },
    cancel() {
      off();
    },
  });
  return new Response(stream, { headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache, no-transform", Connection: "keep-alive" } });
}
