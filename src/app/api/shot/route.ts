/** Proxy a TinyFish step screenshot so the API key stays on the server. */
export async function GET(req: Request) {
  const q = new URL(req.url).searchParams;
  const run = q.get("run") ?? "", step = q.get("step") ?? "";
  if (!/^[\w-]{8,64}$/.test(run) || !/^[\w-]{8,64}$/.test(step)) return new Response("Bad ids", { status: 400 });
  const res = await fetch(`https://agent.tinyfish.ai/v1/runs/${run}/steps/${step}/screenshot`, {
    headers: { "X-API-Key": process.env.TINYFISH_API_KEY ?? "" },
  });
  if (!res.ok) return new Response("Screenshot unavailable", { status: res.status });
  return new Response(res.body, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, max-age=86400" } });
}
