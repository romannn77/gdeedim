import { demo, db } from './db.mjs';
import { audit } from './security.mjs';
export async function importCatalog(data) {
  if (!Array.isArray(data.venues) || !data.venues.length) throw new Error('Снимок каталога пуст.');
  if (demo !== (data.source === 'Учебный каталог'))
    throw new Error('Режим каталога и базы различается.');
  return db.transaction(async (tx) => {
    await tx.query('SELECT pg_advisory_xact_lock(7012401)');
    for (const v of data.venues) {
      await tx.query(
        `INSERT INTO venues(id,name,type,lat,lon,address,hours,source_url,verified_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
        ON CONFLICT(id) DO UPDATE SET name=excluded.name,type=excluded.type,lat=excluded.lat,lon=excluded.lon,address=excluded.address,
        hours=excluded.hours,source_url=excluded.source_url,verified_at=excluded.verified_at,
        review=CASE WHEN venues.review='Нет в новом снимке' THEN NULL ELSE venues.review END`,
        [
          v.id,
          v.name,
          v.type,
          v.lat,
          v.lon,
          v.address || null,
          v.hours || null,
          v.sourceUrl || null,
          v.verifiedAt || null,
        ],
      );
    }
    const ids = data.venues.map((v) => v.id);
    for (const item of data.review || []) {
      const key = [item.issue, ...[...item.ids].sort()].join(':');
      await tx.query(
        `INSERT INTO import_reviews(key,source_ids,note,seen_at) VALUES($1,$2,$3,$4)
        ON CONFLICT(key) DO UPDATE SET seen_at=excluded.seen_at,note=excluded.note`,
        [key, item.ids, item.note, Date.now()],
      );
    }
    await tx.query(
      "UPDATE venues SET review='Нет в новом снимке' WHERE NOT(id=ANY($1::text[])) AND visibility='visible'",
      [ids],
    );
    await tx.query('INSERT INTO imports(at,source,count,boundary,verified) VALUES($1,$2,$3,$4,$5)', [
      Date.now(),
      data.source,
      ids.length,
      String(data.boundaryId || ''),
      data.verifiedAt || data.importedAt,
    ]);
    await audit(tx, 'Импорт', 'Обновлён каталог', String(ids.length));
    return ids.length;
  });
}
export function ttl() {
  const n = Number(process.env.AVAILABILITY_TTL_MINUTES || 30);
  return (Number.isFinite(n) && n > 0 ? n : 30) * 60000;
}
export async function catalog() {
  const now = Date.now();
  const { rows } =
    await db.query(`SELECT v.id,v.name,v.type,v.lat,v.lon,v.address,v.hours,v.source_url AS "sourceUrl",v.verified_at AS "verifiedAt",
    v.status,v.party,v.updated_at,v.people,v.measured_at,v.capacity,
    EXISTS(SELECT 1 FROM users u WHERE u.venue_id=v.id AND u.role='partner') AS partner
    FROM venues v WHERE visibility='visible' ORDER BY v.name,v.id`);
  const offers = (
    await db.query(
      `SELECT o.id,o.venue_id AS "venueId",title,terms,starts,ends FROM offers o JOIN venues v ON v.id=o.venue_id
    WHERE state='approved' AND v.visibility='visible' AND starts <= $1 AND ends > $1
    AND (SELECT count(*) FROM redemptions r WHERE r.offer_id=o.id)<o.max_uses ORDER BY ends`,
      [now],
    )
  ).rows;
  const last =
    (await db.query('SELECT at,source,count,boundary,verified FROM imports ORDER BY id DESC LIMIT 1'))
      .rows[0] || null;
  return {
    demo,
    ttl: ttl(),
    last,
    venues: rows.map((v) => {
      const { updated_at, measured_at, capacity, people, ...info } = v;
      const fresh = Number(updated_at) > now - ttl(),
        counterFresh = Number(measured_at) > now - ttl();
      return {
        ...info,
        status: fresh ? v.status : null,
        party: fresh ? v.party : null,
        updatedAt: Number(updated_at) || null,
        measuredAt: Number(measured_at) || null,
        occupancy: counterFresh && capacity ? Math.round((100 * people) / capacity) : null,
        offers: offers.filter((o) => o.venueId === v.id),
      };
    }),
  };
}
