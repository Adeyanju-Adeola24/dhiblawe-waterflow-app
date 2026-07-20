import pg from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { DATABASE_URL } from './env.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, '..', '..', 'migrations');

let pool = null;
let txClient = null;

function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: DATABASE_URL,
      max: 10,
      idleTimeoutMillis: 30000,
    });
  }
  return pool;
}

function convertParams(sql, params) {
  if (!params || params.length === 0) return sql;
  let idx = 0;
  return sql.replace(/\?/g, () => `$${++idx}`);
}

async function exec(sql, params = []) {
  const c = convertParams(sql, params);
  if (txClient) return txClient.query(c, params);
  return getPool().query(c, params);
}

export async function initDb() {
  const p = getPool();
  const files = fs.readdirSync(MIGRATIONS_DIR).sort();
  for (const f of files) {
    if (!f.endsWith('.sql')) continue;
    const sql = fs.readFileSync(path.join(MIGRATIONS_DIR, f), 'utf-8');
    const statements = sql.split(';').map(s => s.trim()).filter(s => s.length > 0);
    for (const stmt of statements) {
      await p.query(stmt + ';');
    }
  }
  console.log('Database initialized');
}

export async function queryAll(sql, params = []) {
  const r = await exec(sql, params);
  return r.rows;
}

export async function queryOne(sql, params = []) {
  const rows = await queryAll(sql, params);
  return rows[0] || null;
}

export async function execute(sql, params = []) {
  return exec(sql, params);
}

export async function transaction(fn) {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    txClient = client;
    await fn();
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    txClient = null;
    client.release();
  }
}
