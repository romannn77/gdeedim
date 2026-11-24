import { randomBytes, randomUUID } from 'node:crypto';
import { db, demo } from './db.mjs';
import { catalog, ttl } from './catalog.mjs';
import { billing, entitled } from './billing.mjs';
import { audit, digest, fail, hashPassword, integer, matches, string } from './security.mjs';
export const cookieName = demo ? 'ge_demo_session' : 'ge_session';
export async function session(token, tx = db) {
  if (!token) return null;
  return (
    (
      await tx.query(
        `SELECT u.id,u.email,u.role,u.venue_id AS "venueId" FROM users u
    JOIN sessions s ON u.id=s.user_id WHERE s.token=$1 AND s.expires>$2`,
        [digest(token), Date.now()],
      )
    ).rows[0] || null
  );
}
function role(user, allowed) {
  if (!user) fail(401, 'Сначала войдите в аккаунт.');
  if (allowed && user.role !== allowed) fail(403, 'Недостаточно прав для этого действия.');
}
const activeVenue = async (tx, id) => {
  const v = (await tx.query("SELECT id FROM venues WHERE id=$1 AND visibility='visible'", [id]))
    .rows[0];
  if (!v) fail(404, 'Заведение не найдено.');
};
async function authenticate(action, body) {
  const email = string(body.email, 3, 254, 'Электронная почта').toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail(400, 'Введите электронную почту.');
  const password = body.password;
  if (
    typeof password !== 'string' ||
    password.length < (action === 'register' ? 10 : 1) ||
    password.length > 192
  )
    fail(400, 'Проверьте пароль. При регистрации нужно от 10 до 192 символов.');
  const now = Date.now();
  const {
    rows: [attempt],
  } = await db.query(
    `INSERT INTO attempts(key,since,n) VALUES($1,$2,1) ON CONFLICT(key) DO UPDATE SET
    since=CASE WHEN attempts.since<$3 THEN $2 ELSE attempts.since END,n=CASE WHEN attempts.since<$3 THEN 1 ELSE attempts.n+1 END RETURNING n`,
    [digest(email), now, now - 600000],
  );
  if (attempt.n > 20) fail(429, 'Слишком много попыток. Повторите через 10 минут.');
  return db.transaction(async (tx) => {
    let user;
    if (action === 'register') {
      user = (
        await tx.query(
          'INSERT INTO users(id,email,password) VALUES($1,$2,$3) ON CONFLICT(email) DO NOTHING RETURNING id',
          [randomUUID(), email, await hashPassword(password)],
        )
      ).rows[0];
      if (!user) fail(409, 'Не удалось создать аккаунт с этой почтой.');
    } else {
      user = (await tx.query('SELECT id,password FROM users WHERE email=$1', [email])).rows[0];
      if (!(await matches(password, user?.password || '0.'.padEnd(130, '0'))) || !user)
        fail(401, 'Неверная почта или пароль.');
    }
    await tx.query('DELETE FROM attempts WHERE key=$1', [digest(email)]);
    const token = randomBytes(32).toString('hex');
    await tx.query('INSERT INTO sessions VALUES($1,$2,$3)', [
      digest(token),
      user.id,
      now + 30 * 86400000,
    ]);
    return { token };
  });
}
async function counter(body, authorization) {
  if (!/^Bearer [a-f0-9]{64}$/.test(authorization || '')) fail(401, 'Нужен ключ счётчика.');
  if (Object.keys(body).some((k) => !['people', 'timestamp'].includes(k)))
    fail(400, 'Допустимы только количество людей и время.');
  const now = Date.now();
  integer(body.timestamp, Math.ceil(now - ttl() + 1), now, 'Время измерения');
  return db.transaction(async (tx) => {
    const v = (
      await tx.query(
        "SELECT id,capacity,measured_at FROM venues WHERE counter_hash=$1 AND visibility='visible' FOR UPDATE",
        [digest(authorization.slice(7))],
      )
    ).rows[0];
    if (!v) fail(403, 'Ключ недействителен.');
    if (!v.capacity) fail(409, 'Вместимость не подтверждена.');
    integer(body.people, 0, v.capacity, 'Количество людей');
    if (body.timestamp <= Number(v.measured_at)) fail(409, 'Уже есть более новое измерение.');
    await tx.query('UPDATE venues SET people=$1,measured_at=$2 WHERE id=$3', [
      body.people,
      body.timestamp,
      v.id,
    ]);
    return { ok: true };
  });
}
async function partner(tx, user, action, b) {
  role(user, 'partner');
  if (!user.venueId || (b.venueId && b.venueId !== user.venueId))
    fail(403, 'У сотрудника нет доступа к этому заведению.');
  const id = user.venueId;
  await activeVenue(tx, id);
  if (action === 'workspace') {
    const venue = (
      await tx.query('SELECT id,name,status,updated_at AS "updatedAt",party FROM venues WHERE id=$1', [
        id,
      ])
    ).rows[0];
    const offers = (
      await tx.query(
        'SELECT o.*,(SELECT count(*) FROM redemptions r WHERE r.offer_id=o.id) AS uses,(SELECT count(*) FROM redemptions r WHERE r.offer_id=o.id AND r.used_at IS NOT NULL) AS confirmed FROM offers o WHERE venue_id=$1 ORDER BY starts DESC',
        [id],
      )
    ).rows;
    return { venue, offers, ttl: ttl() };
  }
  if (action === 'availability') {
    if (!['free', 'few', 'full'].includes(b.status)) fail(400, 'Выберите наличие столиков.');
    const party =
      b.party == null || b.status === 'full' ? null : integer(b.party, 1, 200, 'Размер компании');
    await tx.query('UPDATE venues SET status=$1,party=$2,updated_at=$3 WHERE id=$4', [
      b.status,
      party,
      Date.now(),
      id,
    ]);
  } else if (action === 'confirm') {
    const ticket = string(b.ticket, 16, 16, 'Номер выдачи').toUpperCase();
    const result = await tx.query(
      `UPDATE redemptions r SET used_at=$1 FROM offers o WHERE r.offer_id=o.id
      AND r.ticket=$2 AND o.venue_id=$3 AND o.state='approved' AND o.starts<=$1 AND o.ends>$1 AND r.used_at IS NULL RETURNING r.offer_id`,
      [Date.now(), ticket, id],
    );
    if (!result.rowCount) fail(409, 'Номер недействителен для этого заведения или уже погашен.');
    await audit(tx, user.email, 'Погашен промокод', result.rows[0].offer_id);
    return { ok: true };
  } else if (action === 'offer') {
    const fields = [
      string(b.title, 2, 100, 'Название'),
      string(b.terms, 3, 800, 'Условия'),
      string(b.code, 1, 80, 'Промокод'),
      integer(b.starts, 1, 9e15, 'Начало'),
      integer(b.ends, Date.now() + 1, 9e15, 'Окончание'),
      integer(b.maxUses, 1, 100000, 'Лимит'),
    ];
    if (b.ends <= b.starts) fail(400, 'Окончание должно быть позже начала.');
    if (b.id) {
      const result = await tx.query(
        "UPDATE offers SET title=$1,terms=$2,code=$3,starts=$4,ends=$5,max_uses=$6,state='pending' WHERE id=$7 AND venue_id=$8",
        [...fields, b.id, id],
      );
      if (!result.rowCount) fail(403, 'Нет доступа к предложению.');
    } else
      await tx.query(
        'INSERT INTO offers(title,terms,code,starts,ends,max_uses,id,venue_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8)',
        [...fields, randomUUID(), id],
      );
  } else fail(404, 'Действие не найдено.');
  await audit(
    tx,
    user.email,
    action === 'offer' ? 'Предложение отправлено на проверку' : 'Обновлены столики',
    id,
  );
  return { ok: true };
}
async function admin(tx, user, action, b) {
  role(user, 'admin');
  if (action === 'workspace') {
    const get = async (sql) => (await tx.query(sql)).rows;
    return {
      venues: await get(
        'SELECT id,name,visibility,review,duplicate_of,status,updated_at,address FROM venues ORDER BY name',
      ),
      users: await get(
        'SELECT u.id,u.email,u.role,u.venue_id,a.venue_id AS requested FROM users u LEFT JOIN applications a ON a.user_id=u.id ORDER BY email',
      ),
      imports: await get('SELECT * FROM imports ORDER BY id DESC LIMIT 30'),
      audit: await get('SELECT * FROM audit ORDER BY id DESC LIMIT 100'),
      reviews: await get(
        'SELECT * FROM import_reviews WHERE resolved_at IS NULL ORDER BY seen_at DESC',
      ),
      offers: await get(
        'SELECT id,venue_id,title,terms,state,starts,ends,max_uses FROM offers ORDER BY starts DESC',
      ),
      subscriptions: await get(
        'SELECT a.user_id,u.email,a.trial_until,a.paid_until,a.test_paid_until FROM billing_accounts a LEFT JOIN users u ON u.id=a.user_id',
      ),
      payments: await get(
        'SELECT p.id,u.email,p.status,p.mode,p.updated_at FROM billing_payments p LEFT JOIN users u ON u.id=p.user_id ORDER BY p.updated_at DESC LIMIT 100',
      ),
      ttl: ttl(),
    };
  }
  let target;
  if (action === 'assign') {
    target = string(b.userId, 1, 128, 'Пользователь');
    if (b.venueId) await activeVenue(tx, b.venueId);
    const changed = await tx.query(
      "UPDATE users SET venue_id=$1,role=$2 WHERE id=$3 AND role!='admin'",
      [b.venueId || null, b.venueId ? 'partner' : 'user', target],
    );
    if (!changed.rowCount) fail(404, 'Аккаунт сотрудника не найден.');
    await tx.query('DELETE FROM applications WHERE user_id=$1', [target]);
  } else if (action === 'moderate') {
    if (!['approved', 'rejected'].includes(b.state)) fail(400, 'Выберите решение.');
    target = b.id;
    if (!(await tx.query('UPDATE offers SET state=$1 WHERE id=$2', [b.state, target])).rowCount)
      fail(404, 'Предложение не найдено.');
  } else if (action === 'resolve') {
    target = string(b.key, 1, 300, 'Запись проверки');
    const note = string(b.resolution, 3, 500, 'Решение');
    if (
      !(
        await tx.query(
          'UPDATE import_reviews SET resolved_at=$1,resolution=$2 WHERE key=$3 AND resolved_at IS NULL',
          [Date.now(), note, target],
        )
      ).rowCount
    )
      fail(404, 'Запись уже проверена.');
  } else if (action === 'venue') {
    target = b.id;
    if (!['visible', 'closed', 'duplicate'].includes(b.visibility))
      fail(400, 'Выберите состояние записи.');
    if (b.visibility === 'duplicate') {
      if (b.duplicateOf === target) fail(400, 'Укажите другую запись.');
      await activeVenue(tx, b.duplicateOf);
    }
    if (
      !(
        await tx.query('UPDATE venues SET visibility=$1,duplicate_of=$2,review=NULL WHERE id=$3', [
          b.visibility,
          b.visibility === 'duplicate' ? b.duplicateOf : null,
          target,
        ])
      ).rowCount
    )
      fail(404, 'Запись не найдена.');
  } else fail(404, 'Действие не найдено.');
  await audit(
    tx,
    user.email,
    {
      assign: 'Изменён доступ сотрудника',
      moderate: 'Модерация предложения',
      venue: 'Проверена запись каталога',
      resolve: 'Закрыт вопрос импорта',
    }[action],
    String(target) + ' · ' + String(b.resolution || b.state || b.visibility || b.venueId || 'отозван'),
  );
  return { ok: true };
}
export async function dispatch(path, { token, body: b = {}, authorization } = {}) {
  if (path === 'catalog') return catalog();
  if (path === 'login' || path === 'register') return authenticate(path, b);
  if (path === 'counter') return counter(b, authorization);
  if (path === 'billing/notify') return billing(db, 'notify', { body: b });
  if (path === 'logout') {
    if (token) await db.query('DELETE FROM sessions WHERE token=$1', [digest(token)]);
    return { ok: true };
  }
  const user = await session(token);
  if (path === 'me')
    return {
      user,
      favorites: user
        ? (await db.query('SELECT venue_id FROM favorites WHERE user_id=$1', [user.id])).rows.map(
            (r) => r.venue_id,
          )
        : [],
    };
  role(user);
  if (path.startsWith('billing/')) return billing(db, path.slice(8), { userId: user.id, body: b });
  return db.transaction(async (tx) => {
    // Роль и назначение остаются неизменными до завершения действия.
    await tx.query('SELECT id FROM users WHERE id=$1 FOR SHARE', [user.id]);
    const current = await session(token, tx);
    role(current);
    if (path.startsWith('partner/')) return partner(tx, current, path.slice(8), b);
    if (path.startsWith('admin/')) return admin(tx, current, path.slice(6), b);
    if (path === 'favorite') {
      await activeVenue(tx, b.venueId);
      if (typeof b.saved !== 'boolean') fail(400, 'Укажите состояние избранного.');
      if (b.saved)
        await tx.query('INSERT INTO favorites VALUES($1,$2) ON CONFLICT DO NOTHING', [
          user.id,
          b.venueId,
        ]);
      else
        await tx.query('DELETE FROM favorites WHERE user_id=$1 AND venue_id=$2', [user.id, b.venueId]);
    } else if (path === 'apply') {
      await activeVenue(tx, b.venueId);
      await tx.query(
        'INSERT INTO applications VALUES($1,$2,$3) ON CONFLICT(user_id) DO UPDATE SET venue_id=excluded.venue_id,created_at=excluded.created_at',
        [user.id, b.venueId, Date.now()],
      );
      await audit(tx, user.email, 'Заявка сотрудника', b.venueId);
    } else if (path === 'report') {
      await activeVenue(tx, b.venueId);
      await tx.query('UPDATE venues SET review=$1 WHERE id=$2', [
        string(b.note, 3, 300, 'Что проверить'),
        b.venueId,
      ]);
      await audit(tx, user.email, 'Замечание к каталогу', b.venueId);
    } else if (path === 'my-codes') {
      if (!(await entitled(tx, user.id))) return { codes: [] };
      const codes = (
        await tx.query(
          `SELECT v.name,o.title,o.terms,o.code,o.ends,r.ticket,r.used_at FROM redemptions r
        JOIN offers o ON o.id=r.offer_id JOIN venues v ON v.id=o.venue_id WHERE r.user_id=$1 AND o.state='approved' AND
        v.visibility='visible' AND o.starts<=$2 AND o.ends>$2 ORDER BY r.at DESC`,
          [user.id, Date.now()],
        )
      ).rows;
      return { codes };
    } else if (path === 'redeem') {
      if (!(await entitled(tx, user.id))) fail(403, 'Промокоды доступны с подпиской «ГдеЕдим? Плюс».');
      const o = (
        await tx.query(
          "SELECT o.* FROM offers o JOIN venues v ON v.id=o.venue_id WHERE o.id=$1 AND v.visibility='visible' AND state='approved' AND starts<=$2 AND ends>$2 FOR UPDATE OF o",
          [b.id, Date.now()],
        )
      ).rows[0];
      if (!o) fail(404, 'Предложение больше недоступно.');
      let receipt = (
        await tx.query('SELECT ticket FROM redemptions WHERE user_id=$1 AND offer_id=$2', [
          user.id,
          o.id,
        ])
      ).rows[0];
      if (!receipt) {
        const n = Number(
          (await tx.query('SELECT count(*) FROM redemptions WHERE offer_id=$1', [o.id])).rows[0].count,
        );
        if (n >= o.max_uses) fail(409, 'Лимит выдачи исчерпан.');
        receipt = (
          await tx.query(
            'INSERT INTO redemptions(offer_id,user_id,at,ticket) VALUES($1,$2,$3,$4) RETURNING ticket',
            [o.id, user.id, Date.now(), randomBytes(8).toString('hex').toUpperCase()],
          )
        ).rows[0];
        await audit(tx, user.email, 'Выдан промокод', o.id);
      }
      return { code: o.code, ticket: receipt.ticket, terms: o.terms };
    } else fail(404, 'Действие не найдено.');
    return { ok: true };
  });
}
