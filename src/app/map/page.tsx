import Link from "next/link";
import { getCountryCounts } from "@/geo/countryCounts";

// Note: bubbles use a native SVG <a> (not next/link) — an HTML anchor inside
// <svg> hydrates in the wrong namespace and mismatches.

export const dynamic = "force-dynamic";

const W = 900;
const H = 450;
const project = (lon: number, lat: number) => ({
  x: ((lon + 180) / 360) * W,
  y: ((90 - lat) / 180) * H,
});

export default async function MapPage() {
  const counts = await getCountryCounts();
  const maxTotal = Math.max(1, ...counts.map((c) => c.total));
  const graticule: React.ReactNode[] = [];
  for (let lon = -150; lon <= 150; lon += 30) {
    const { x } = project(lon, 0);
    graticule.push(<line key={`v${lon}`} className="map-graticule" x1={x} y1={0} x2={x} y2={H} />);
  }
  for (let lat = -60; lat <= 60; lat += 30) {
    const { y } = project(0, lat);
    graticule.push(<line key={`h${lat}`} className="map-graticule" x1={0} y1={y} x2={W} y2={y} />);
  }

  return (
    <main>
      <h1>Geospatial view</h1>
      <p className="sub">
        Watchlisted entities by country — persons by nationality, organizations by jurisdiction.
        Bubble area is proportional to the count; click a country to explore its entities.
      </p>

      <div className="map-wrap">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="World map of entity counts by country">
          <rect className="map-frame" x={0} y={0} width={W} height={H} />
          {graticule}
          {counts.map((c) => {
            const { x, y } = project(c.lon, c.lat);
            const r = 4 + Math.sqrt(c.total / maxTotal) * 26;
            return (
              <a key={c.code} href={`/explore?type=person&nationality=${c.code}`}>
                <circle className="map-bubble" cx={x} cy={y} r={r}>
                  <title>
                    {c.code}: {c.total} ({c.persons} persons, {c.orgs} orgs)
                  </title>
                </circle>
                {c.total >= maxTotal * 0.12 && (
                  <text className="map-code" x={x} y={y + 3}>
                    {c.code}
                  </text>
                )}
              </a>
            );
          })}
        </svg>
      </div>

      <h2>By country</h2>
      <div className="panel tablewrap">
        <table>
          <thead>
            <tr>
              <th>Country</th>
              <th>Persons</th>
              <th>Organizations</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {counts.map((c) => (
              <tr key={c.code}>
                <td>
                  <Link className="rowlink" href={`/explore?type=person&nationality=${c.code}`}>
                    {c.code}
                  </Link>
                </td>
                <td className="num">{c.persons}</td>
                <td className="num">{c.orgs}</td>
                <td className="num">{c.total}</td>
              </tr>
            ))}
            {!counts.length && (
              <tr>
                <td colSpan={4} className="empty">
                  No geocodable entities yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </main>
  );
}
