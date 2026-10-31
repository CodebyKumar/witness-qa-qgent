import type { Metadata } from "next";
import localFont from "next/font/local";
import Sidebar from "./sidebar";
import "./globals.css";

// Self-hosted: next/font/google breaks on Google's extensionless font URLs, and this needs no network at build.
const sans = localFont({ src: "./fonts/geist-latin.woff2", variable: "--font-geist", weight: "100 900", display: "swap" });
const mono = localFont({ src: "./fonts/geist-mono-latin.woff2", variable: "--font-geist-mono", weight: "100 900", display: "swap" });
const brand = localFont({ src: "./fonts/fraunces-latin.woff2", variable: "--font-brand", weight: "400 700", display: "swap" });

export const metadata: Metadata = {
  title: "Witness - plain-English website testing on TinyFish",
  description: "Describe what to test in plain English; TinyFish agents run it on the live site and an independent verifier reports pass or fail with evidence.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${brand.variable}`}>
      <body>
        <div className="shell">
          <Sidebar />
          <main className="page">{children}</main>
        </div>
      </body>
    </html>
  );
}
