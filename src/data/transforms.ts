// Transform registry: pure functions from input records to output records.
// A transform's inputs/outputs are declared in the transform table; the
// entrypoint names a function here. Ontology-bound transforms emit
// ObjectOut/LinkOut; dataset-bound transforms emit DsRecords.

import { DsRecord } from "./datasets";
import { OntologyOut } from "./ontologyWriter";

export type TransformFn = (
  inputs: Record<string, DsRecord[]>
) => OntologyOut[] | DsRecord[];

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

const rssToDocuments: TransformFn = (inputs) => {
  const rows = Object.values(inputs)[0] ?? [];
  return rows.map((r) => {
    const p = r.payload as Record<string, string | null>;
    return {
      kind: "object" as const,
      type: "document",
      pk: p.link ?? r.pk,
      props: {
        title: p.title,
        url: p.link,
        source_name: p.feed_name ?? hostOf(p.link) ?? "rss",
        published_at: p.published_at,
        text: p.snippet,
      },
    };
  });
};

const gdeltToDocuments: TransformFn = (inputs) => {
  const rows = Object.values(inputs)[0] ?? [];
  return rows.map((r) => {
    const p = r.payload as Record<string, string | null>;
    return {
      kind: "object" as const,
      type: "document",
      pk: p.url ?? r.pk,
      props: {
        title: p.title,
        url: p.url,
        source_name: p.domain ?? "gdelt",
        published_at: p.seendate,
        text: p.title,
      },
    };
  });
};

const PERSON_SCHEMAS = new Set(["Person"]);
const ORG_SCHEMAS = new Set(["Organization", "Company", "LegalEntity", "PublicBody"]);

const sanctionsToEntities: TransformFn = (inputs) => {
  const rows = Object.values(inputs)[0] ?? [];
  const out: OntologyOut[] = [];
  for (const r of rows) {
    const p = r.payload as Record<string, string | null>;
    const schema = p.schema ?? "";
    const aliases = (p.aliases ?? "")
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 12);
    const firstCountry = (p.countries ?? "").split(";")[0]?.trim() || null;
    if (PERSON_SCHEMAS.has(schema)) {
      out.push({
        kind: "object",
        type: "person",
        pk: r.pk,
        props: {
          name: p.name,
          aliases,
          nationality: firstCountry ? firstCountry.toUpperCase() : null,
          birth_date: /^\d{4}-\d{2}-\d{2}$/.test(p.birth_date ?? "") ? p.birth_date : null,
          watchlist: p.dataset,
        },
      });
    } else if (ORG_SCHEMAS.has(schema)) {
      out.push({
        kind: "object",
        type: "organization",
        pk: r.pk,
        props: {
          name: p.name,
          jurisdiction: firstCountry ? firstCountry.toUpperCase() : null,
          org_type: schema.toLowerCase(),
          watchlist: p.dataset,
        },
      });
    }
  }
  return out;
};

export const TRANSFORM_REGISTRY: Record<string, TransformFn> = {
  rssToDocuments,
  gdeltToDocuments,
  sanctionsToEntities,
};
