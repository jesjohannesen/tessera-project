// Source connectors: each fetches from one external system and returns raw
// records for an append transaction. Connectors never touch the ontology —
// raw data lands in datasets; transforms do the mapping.

import Parser from "rss-parser";
import { parse as parseCsv } from "csv-parse/sync";
import { DsRecord } from "./datasets";

export interface ConnectorResult {
  records: DsRecord[];
  note?: string;
}

export type SourceConfig = Record<string, unknown>;

export async function fetchRss(config: SourceConfig): Promise<ConnectorResult> {
  const feeds = (config.feeds ?? []) as { url: string; name?: string }[];
  if (!feeds.length) throw new Error("rss source has no feeds configured");
  const parser = new Parser({ timeout: 20000 });
  const records: DsRecord[] = [];
  const failures: string[] = [];
  for (const feed of feeds) {
    try {
      const parsed = await parser.parseURL(feed.url);
      for (const item of parsed.items ?? []) {
        const pk = item.guid ?? item.link;
        if (!pk) continue;
        records.push({
          pk,
          payload: {
            guid: item.guid ?? null,
            title: item.title ?? null,
            link: item.link ?? null,
            published_at: item.isoDate ?? item.pubDate ?? null,
            snippet: item.contentSnippet?.slice(0, 2000) ?? null,
            feed_name: feed.name ?? parsed.title ?? feed.url,
            feed_url: feed.url,
          },
        });
      }
    } catch (err) {
      failures.push(`${feed.url}: ${(err as Error).message}`);
    }
  }
  if (failures.length === feeds.length)
    throw new Error(`all feeds failed: ${failures.join("; ")}`);
  return {
    records,
    note: failures.length ? `partial: ${failures.join("; ")}` : undefined,
  };
}

export async function fetchGdelt(config: SourceConfig): Promise<ConnectorResult> {
  const query = String(config.query ?? "");
  if (!query) throw new Error("gdelt source has no query configured");
  const maxrecords = Number(config.maxrecords ?? 75);
  const timespan = String(config.timespan ?? "3d");
  const url = `https://api.gdeltproject.org/api/v2/doc/doc?query=${encodeURIComponent(query)}&mode=artlist&maxrecords=${maxrecords}&timespan=${timespan}&sort=datedesc&format=json`;
  let res: Response;
  try {
    res = await fetch(url, {
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(30000),
    });
  } catch (err) {
    throw new Error(`gdelt unreachable: ${(err as Error).message} (the API rate-limits per IP; retry later)`);
  }
  const text = await res.text();
  if (res.status === 429)
    throw new Error("gdelt rate-limited (429) — will succeed on a later run");
  if (!res.ok) throw new Error(`gdelt http ${res.status}: ${text.slice(0, 200)}`);
  let json: { articles?: Record<string, unknown>[] };
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`gdelt returned non-JSON: ${text.slice(0, 200)}`);
  }
  const records: DsRecord[] = (json.articles ?? []).flatMap((a) => {
    const articleUrl = String(a.url ?? "");
    if (!articleUrl) return [];
    const seen = String(a.seendate ?? ""); // 20260812T063000Z
    const iso =
      seen.length >= 15
        ? `${seen.slice(0, 4)}-${seen.slice(4, 6)}-${seen.slice(6, 8)}T${seen.slice(9, 11)}:${seen.slice(11, 13)}:${seen.slice(13, 15)}Z`
        : null;
    return [
      {
        pk: articleUrl,
        payload: {
          url: articleUrl,
          title: a.title ?? null,
          seendate: iso,
          domain: a.domain ?? null,
          language: a.language ?? null,
          sourcecountry: a.sourcecountry ?? null,
        },
      },
    ];
  });
  return { records };
}

export async function fetchOpenSanctions(config: SourceConfig): Promise<ConnectorResult> {
  const dataset = String(config.dataset ?? "eu_fsf");
  const maxRecords = Number(config.maxRecords ?? 500);
  const url = `https://data.opensanctions.org/datasets/latest/${dataset}/targets.simple.csv`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`opensanctions http ${res.status} for ${url}`);
  const text = await res.text();
  const rows: Record<string, string>[] = parseCsv(text, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
  });
  const capped = rows.slice(0, maxRecords);
  const records: DsRecord[] = capped.flatMap((r) => {
    if (!r.id) return [];
    return [
      {
        pk: r.id,
        payload: {
          id: r.id,
          schema: r.schema ?? null,
          name: r.name ?? null,
          aliases: r.aliases ?? null,
          birth_date: r.birth_date ?? null,
          countries: r.countries ?? null,
          identifiers: r.identifiers ?? null,
          sanctions: r.sanctions ?? null,
          dataset,
          first_seen: r.first_seen ?? null,
          last_seen: r.last_seen ?? null,
        },
      },
    ];
  });
  return {
    records,
    note:
      rows.length > maxRecords
        ? `capped at ${maxRecords} of ${rows.length} rows (raise config.maxRecords to widen)`
        : undefined,
  };
}

export const CONNECTORS: Record<
  string,
  (config: SourceConfig) => Promise<ConnectorResult>
> = {
  rss: fetchRss,
  gdelt: fetchGdelt,
  opensanctions: fetchOpenSanctions,
};
