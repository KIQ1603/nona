import pg from 'pg';

export function connectionString(): string {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is not set');
  return url;
}

export function createClient(): pg.Client {
  return new pg.Client({ connectionString: connectionString() });
}
