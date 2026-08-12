import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tessera",
  description: "An experiment in ontology, data layers, and composable analytical products.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <div className="shell">
          <div className="topbar">
            <span className="wordmark">
              <Link href="/">Tessera</Link>
            </span>
            <nav className="nav">
              <Link href="/">Ontology</Link>
              <Link href="/data">Data</Link>
              <Link href="/resolve">Resolve</Link>
            </nav>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
