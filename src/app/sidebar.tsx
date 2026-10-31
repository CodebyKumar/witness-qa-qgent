"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import type { RunSummary } from "@/lib/runs";

function ago(iso: string) {
  const s = Math.max(1, Math.round((Date.now() - Date.parse(iso)) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

export default function Sidebar() {
  const path = usePathname();
  const [runs, setRuns] = useState<RunSummary[] | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    const load = async () => {
      const list: RunSummary[] = await fetch("/api/runs").then((r) => (r.ok ? r.json() : [])).catch(() => []);
      if (stop) return;
      setRuns(list);
      if (list.some((r) => r.active)) timer = setTimeout(load, 5000); // keep results fresh while something runs
    };
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [path]);

  const nav = [
    { href: "/", label: "New run", active: path === "/" },
    { href: "/runs", label: "Run history", active: path === "/runs" },
  ];

  return (
    <aside className="sidebar" aria-label="Navigation">
      <Link href="/" className="brand" aria-label="Witness, new test run">
        <span className="brand__name">Witness</span>
      </Link>

      <nav className="sidenav" aria-label="Main">
        {nav.map((n) => (
          <Link key={n.href} href={n.href} className="sidenav__link" aria-current={n.active ? "page" : undefined}>
            {n.label}
          </Link>
        ))}
      </nav>

      <div className="recent">
        <h2 className="recent__head">Recent runs</h2>
        {runs === null ? (
          <div className="skeleton skeleton--row" aria-label="Loading runs" />
        ) : runs.length === 0 ? (
          <p className="recent__empty">Runs you start appear here.</p>
        ) : (
          <ul className="recent__list">
            {runs.slice(0, 12).map((r) => (
              <li key={r.id}>
                <Link href={`/runs/${r.id}`} className="recent__item" aria-current={path === `/runs/${r.id}` ? "page" : undefined}>
                  <span className="recent__host">{r.host}</span>
                  <span className="recent__meta">
                    {r.active ? (
                      <span className="status status--running">running</span>
                    ) : (
                      <span className={r.fail ? "v-fail" : r.pass ? "v-pass" : ""}>
                        {r.fail ? `${r.fail} failed` : r.pass ? `${r.pass} passed` : "no verdict"}
                      </span>
                    )}
                    <span>{ago(r.createdAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      <p className="sidebar__foot">QA agent on TinyFish</p>
    </aside>
  );
}
