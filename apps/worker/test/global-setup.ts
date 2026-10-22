import { execFileSync } from 'node:child_process';
import path from 'node:path';
import pg from 'pg';

const ADMIN_URL =
  process.env.TEST_ADMIN_DATABASE_URL ?? 'postgres://nona:nona@localhost:5433/postgres';
const TEST_DB = 'nona_worker_test';

export default async function setup() {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${TEST_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${TEST_DB}`);
  await admin.end();
  const url = new URL(ADMIN_URL);
  url.pathname = `/${TEST_DB}`;
  process.env.TEST_DATABASE_URL = url.toString();
  execFileSync('node_modules/.bin/tsx', ['src/cli.ts', 'migrate'], {
    cwd: path.resolve(__dirname, '../../../database'),
    env: { ...process.env, DATABASE_URL: url.toString() },
    stdio: 'pipe',
  });
}
