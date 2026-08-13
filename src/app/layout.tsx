import type { Metadata } from "next";
import Link from "next/link";
import Script from "next/script";
import { Suspense } from "react";
import "./globals.css";
import { SettingsMenu } from "./components/SettingsMenu";
import { SearchBox } from "./components/SearchBox";

export const metadata: Metadata = {
  title: "Tessera",
  description: "An experiment in ontology, data layers, and composable analytical products.",
};

// Applied before first paint so a chosen theme/font/density never flashes.
const BOOT = `(function(){try{var d=document.documentElement,s=localStorage;
var t=s.getItem('tessera-theme');if(t)d.setAttribute('data-theme',t);
var f=s.getItem('tessera-font');if(f)d.setAttribute('data-font',f);
var n=s.getItem('tessera-density');if(n)d.setAttribute('data-density',n);}catch(e){}})();`;

const NAV = [
  { href: "/", label: "Ontology" },
  { href: "/data", label: "Data" },
  { href: "/resolve", label: "Resolve" },
  { href: "/explore", label: "Explore" },
  { href: "/graph", label: "Graph" },
  { href: "/map", label: "Map" },
  { href: "/timeline", label: "Timeline" },
  { href: "/modules", label: "Modules" },
  { href: "/dossiers", label: "Dossiers" },
  { href: "/ai", label: "AI" },
];

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body>
        <Script id="tessera-theme-boot" strategy="beforeInteractive">
          {BOOT}
        </Script>
        <div className="shell">
          <div className="topbar">
            <span className="wordmark">
              <Link href="/">Tessera</Link>
            </span>
            <nav className="nav">
              {NAV.map((n) => (
                <Link key={n.href} href={n.href}>
                  {n.label}
                </Link>
              ))}
            </nav>
            <div className="topbar-right">
              <Suspense fallback={<span className="searchbox" />}>
                <SearchBox />
              </Suspense>
              <SettingsMenu />
            </div>
          </div>
          {children}
        </div>
      </body>
    </html>
  );
}
