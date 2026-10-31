import type { Metadata } from "next";
import { Chivo_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const chivo = Chivo_Mono({ variable: "--font-chivo-mono", subsets: ["latin"], weight: ["400", "500", "800"] });

export const metadata: Metadata = {
  title: "Witness - plain-English website testing on TinyFish",
  description: "Describe what to test in plain English; TinyFish agents run it on the live site and an independent verifier reports pass or fail with evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={chivo.variable}>
      <body>
        <header className="topbar">
          <div className="container topbar__inner">
            <Link href="/" className="wordmark" aria-label="Witness, new test run">
              Witness
            </Link>
            <span className="topbar__by">QA agent on TinyFish</span>
            <nav aria-label="Main" className="topbar__nav">
              <Link href="/">New run</Link>
              <Link href="/runs">Run history</Link>
            </nav>
          </div>
        </header>
        <main className="container page">{children}</main>
      </body>
    </html>
  );
}
