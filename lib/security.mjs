import { randomBytes, scrypt as derive, timingSafeEqual, createHash } from 'node:crypto';
import { promisify } from 'node:util';
const scrypt = promisify(derive);
export function fail(status, message) {
  throw Object.assign(new Error(message), { status });
}
export const digest = (s) => createHash('sha256').update(s).digest('hex');
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  return salt + '.' + (await scrypt(password, salt, 64)).toString('hex');
}
export async function matches(password, stored) {
  const [salt, key] = stored.split('.');
  return timingSafeEqual(await scrypt(password, salt, 64), Buffer.from(key, 'hex'));
}
export function string(value, min, max, label) {
  if (typeof value !== 'string' || value.trim().length < min || value.length > max)
    fail(400, 'Проверьте поле «' + label + '».');
  return value.trim();
}
export function integer(value, min, max, label) {
  if (!Number.isSafeInteger(value) || value < min || value > max)
    fail(400, 'Недопустимое значение поля «' + label + '».');
  return value;
}
export async function audit(tx, actor, action, target) {
  await tx.query('INSERT INTO audit(at,actor,action,target) VALUES($1,$2,$3,$4)', [
    Date.now(),
    actor,
    action,
    target,
  ]);
}
