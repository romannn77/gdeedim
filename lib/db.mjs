import pg from 'pg';
import { existsSync } from 'node:fs';
if (existsSync('.env')) process.loadEnvFile('.env');
export const demo = process.env.APP_MODE === 'demo';
const schema = demo ? 'guide_demo' : 'guide';
const config = process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {};
const poolKey = Symbol.for('gde-edim.pool.' + schema);
const pool = (globalThis[poolKey] ||= new pg.Pool({
  ...config,
  options: '-c search_path=' + schema + ',public',
  max: 8,
}));
export const db = {
  query(sql, values) {
    return pool.query(sql, values);
  },
  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const value = await fn(client);
      await client.query('COMMIT');
      return value;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },
};
export async function initSchema() {
  await db.query('CREATE SCHEMA IF NOT EXISTS ' + schema);
}
export const close = () => pool.end();
