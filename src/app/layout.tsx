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
            <span className="crumb">ontology spine · phase 0</span>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
