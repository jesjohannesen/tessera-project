import Link from "next/link";
import { getPool } from "@/db/client";

export const dynamic = "force-dynamic";

interface TLItem {
  ts: string;
  type: string;
  pk: string;
  title: string;
  kind: string;
}

export default async function TimelinePage() {
  const pool = getPool();
  // Events (occurred_at) and documents (published_at) on one temporal axis.
  const res = await pool.query(`
    select ts, kind, obj_type, pk, title from (
      select (o.props->>'occurred_at') as ts, 'event' as kind, 'event' as obj_type,
             o.pk_value as pk, coalesce(o.props->>'title', o.pk_value) as title
      from obj o join object_type t on t.id = o.object_type_id
      where t.api_name = 'event' and not o.deleted and o.props->>'occurred_at' is not null
      union all
      select (o.props->>'published_at') as ts, 'document' as kind, 'document' as obj_type,
             o.pk_value as pk, coalesce(o.props->>'title', o.pk_value) as title
      from obj o join object_type t on t.id = o.object_type_id
      where t.api_name = 'document' and not o.deleted and o.props->>'published_at' is not null
    ) x
    where ts ~ '^[0-9]{4}'
    order by ts desc
    limit 80
  `);

  const items: TLItem[] = res.rows.map((r) => ({
    ts: r.ts,
    type: r.obj_type,
    pk: r.pk,
    title: r.title,
    kind: r.kind,
  }));

  // Group by calendar day.
  const byDay = new Map<string, TLItem[]>();
  for (const it of items) {
    const day = new Date(it.ts).toISOString().slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day)!.push(it);
  }

  return (
    <main>
      <h1>Timeline</h1>
      <p className="sub">
        Events and source documents on one temporal axis — the most recent {items.length}, grouped
        by day.
      </p>

      {items.length ? (
        <div className="timeline">
          {[...byDay.entries()].map(([day, dayItems]) => (
            <div key={day}>
              <div className="tl-date">{day}</div>
              {dayItems.map((it, i) => (
                <div className="tl-item" key={`${it.pk}-${i}`}>
                  <span className="time">
                    {new Date(it.ts).toISOString().slice(11, 16)}
                  </span>
                  <span>
                    <span className={`chip ${it.kind === "event" ? "edit" : "source"}`}>{it.kind}</span>{" "}
                    <Link className="rowlink" href={`/object/${it.type}/${encodeURIComponent(it.pk)}`}>
                      {it.title}
                    </Link>
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>
      ) : (
        <p className="empty">No time-stamped events or documents yet.</p>
      )}
    </main>
  );
}
