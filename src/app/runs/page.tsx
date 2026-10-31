import Link from "next/link";
import { listRuns } from "@/lib/runs";

export const dynamic = "force-dynamic";

export default async function History() {
  const runs = await listRuns();
  return (
    <section aria-labelledby="history-head">
      <h1 id="history-head">Run history</h1>
      {runs.length === 0 ? (
        <div className="empty">
          <p>No runs yet. Each run you start is saved here with its full report.</p>
          <Link href="/" className="btn btn--primary">Start a test run</Link>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="board">
            <thead>
              <tr>
                <th scope="col">Started</th>
                <th scope="col">Site</th>
                <th scope="col" className="num">Tests</th>
                <th scope="col" className="num">Passed</th>
                <th scope="col" className="num">Failed</th>
                <th scope="col" className="num">Blocked or error</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => {
                const v = Object.values(r.results).map((x) => x.verdict);
                return (
                  <tr key={r.id}>
                    <td className="num"><Link href={`/runs/${r.id}`}>{new Date(r.createdAt).toLocaleString()}</Link></td>
                    <td>{r.url}</td>
                    <td className="num">{r.cases.length}</td>
                    <td className="num v-pass">{v.filter((x) => x === "PASS").length}</td>
                    <td className="num v-fail">{v.filter((x) => x === "FAIL").length}</td>
                    <td className="num">{v.filter((x) => x === "BLOCKED" || x === "ERROR").length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
