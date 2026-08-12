// Aggregates entity counts by country: persons by nationality, organizations
// by jurisdiction. Feeds the bubble map. Only ISO2 codes with a known
// centroid are returned.

import { getPool } from "@/db/client";
import { CENTROIDS } from "./centroids";

export interface CountryCount {
  code: string;
  lon: number;
  lat: number;
  persons: number;
  orgs: number;
  total: number;
}

export async function getCountryCounts(): Promise<CountryCount[]> {
  const res = await getPool().query(`
    select code, sum(persons)::int as persons, sum(orgs)::int as orgs from (
      select upper(o.props->>'nationality') as code, count(*) as persons, 0 as orgs
      from obj o join object_type t on t.id = o.object_type_id
      where t.api_name = 'person' and not o.deleted and o.props->>'nationality' is not null
      group by 1
      union all
      select upper(o.props->>'jurisdiction') as code, 0 as persons, count(*) as orgs
      from obj o join object_type t on t.id = o.object_type_id
      where t.api_name = 'organization' and not o.deleted and o.props->>'jurisdiction' is not null
      group by 1
    ) x
    group by code
  `);

  return res.rows
    .filter((r) => r.code && CENTROIDS[r.code])
    .map((r) => {
      const [lon, lat] = CENTROIDS[r.code];
      return {
        code: r.code,
        lon,
        lat,
        persons: r.persons,
        orgs: r.orgs,
        total: r.persons + r.orgs,
      };
    })
    .sort((a, b) => b.total - a.total);
}
