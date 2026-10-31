import Link from "next/link";
import { listRuns, summarize } from "@/lib/runs";
import HistoryTable from "./history-table";

export const dynamic = "force-dynamic";

export default async function History() {
  const runs = (await listRuns()).map(summarize);
  return (
    <section aria-labelledby="history-head" className="history-page">
      <div className="run-head">
        <div>
          <h1 id="history-head">Run history</h1>
          <p className="muted">Every run is saved with its full report. Select a row to open it.</p>
        </div>
        <Link href="/" className="btn btn--primary">New run</Link>
      </div>
      {runs.length === 0 ? (
        <div className="empty">
          <p>No runs yet. Each run you start is saved here with its full report.</p>
          <Link href="/" className="btn btn--primary">Start a test run</Link>
        </div>
      ) : (
        <HistoryTable runs={runs} />
      )}
    </section>
  );
}
