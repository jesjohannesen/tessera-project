// Tiny markdown-lite renderer: #/##/### headings, paragraphs, "- " bullets,
// **bold**, [text](url) links, and @[type:pk|Label] entity mentions that
// resolve to live object pages. No dependencies, no raw HTML pass-through.

import React from "react";
import Link from "next/link";

function renderInline(text: string, keyBase: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  // Tokenize mentions, links, bold in one pass.
  const re = /@\[([a-z_]+):([^\]|]+)\|([^\]]+)\]|\[([^\]]+)\]\(([^)]+)\)|\*\*([^*]+)\*\*/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let i = 0;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push(text.slice(last, m.index));
    if (m[1]) {
      out.push(
        <Link key={`${keyBase}-m${i}`} className="rowlink" href={`/object/${m[1]}/${encodeURIComponent(m[2])}`}>
          {m[3]}
        </Link>
      );
    } else if (m[4]) {
      out.push(
        <a key={`${keyBase}-a${i}`} className="rowlink" href={m[5]} target="_blank" rel="noreferrer">
          {m[4]}
        </a>
      );
    } else if (m[6]) {
      out.push(<strong key={`${keyBase}-b${i}`}>{m[6]}</strong>);
    }
    last = m.index + m[0].length;
    i++;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

export function Markdown({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.split("\n");
  let para: string[] = [];
  let bullets: string[] = [];
  let key = 0;

  const flushPara = () => {
    if (para.length) {
      blocks.push(<p key={key++}>{renderInline(para.join(" "), `p${key}`)}</p>);
      para = [];
    }
  };
  const flushBullets = () => {
    if (bullets.length) {
      blocks.push(
        <ul key={key++} className="plainlist">
          {bullets.map((b, i) => (
            <li key={i}>{renderInline(b, `l${key}-${i}`)}</li>
          ))}
        </ul>
      );
      bullets = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    const h = line.match(/^(#{1,3})\s+(.*)/);
    if (h) {
      flushPara();
      flushBullets();
      const level = h[1].length;
      const content = renderInline(h[2], `h${key}`);
      blocks.push(
        level === 1 ? <h1 key={key++}>{content}</h1> : level === 2 ? <h2 key={key++}>{content}</h2> : <h3 key={key++}>{content}</h3>
      );
    } else if (line.startsWith("- ")) {
      flushPara();
      bullets.push(line.slice(2));
    } else if (line.trim() === "") {
      flushPara();
      flushBullets();
    } else {
      flushBullets();
      para.push(line);
    }
  }
  flushPara();
  flushBullets();
  return <div className="md">{blocks}</div>;
}
