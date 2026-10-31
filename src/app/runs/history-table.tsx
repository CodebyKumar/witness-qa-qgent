"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { RunSummary } from "@/lib/runs";

/** Whole row opens the run; the site name is the real link for keyboard and screen readers. */
export default function HistoryTable({ runs }: { runs: RunSummary[] }) {
  const router = useRouter();
  return (
    <div className="table-wrap">
      <table className="board history">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">Started</th>
            <th scope="col">Result</th>
            <th scope="col" className="num">Tests</th>
            <th scope="col" className="num">Passed</th>
            <th scope="col" className="num">Failed</th>
            <th scope="col" className="num">Not judged</th>
          </tr>
        </thead>
        <tbody>
          {runs.map((r) => (
            <tr key={r.id} className="is-link" onClick={() => router.push(`/runs/${r.id}`)}>
              <td>
                <Link href={`/runs/${r.id}`} className="row-btn" onClick={(e) => e.stopPropagation()}>
                  {r.host}
                </Link>
                <span className="row-sub">{r.url}</span>
              </td>
              <td className="muted" suppressHydrationWarning>{new Date(r.createdAt).toLocaleString()}</td>
              <td>
                {r.active ? (
                  <span className="status status--running">running</span>
                ) : r.fail ? (
                  <span className="verdict verdict--fail">{r.fail} FAIL</span>
                ) : r.pass ? (
                  <span className="verdict verdict--pass">ALL PASS</span>
                ) : (
                  <span className="verdict verdict--blocked">NO VERDICT</span>
                )}
              </td>
              <td className="num">{r.total}</td>
              <td className="num v-pass">{r.pass}</td>
              <td className="num v-fail">{r.fail}</td>
              <td className="num">{r.other}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
