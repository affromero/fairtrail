import { readFile } from 'node:fs/promises';
import pg from 'pg';

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error('DATABASE_URL is required to apply travel constraints');
const client = new pg.Client({ connectionString: databaseUrl });
try {
  await client.connect();
  const schema = new URL(databaseUrl).searchParams.get('schema') ?? 'public';
  await client.query("SELECT set_config('search_path', $1, false)", [`"${schema.replaceAll('"', '""')}"`]);
  const sql = await readFile(new URL('../apps/web/prisma/travel-constraints.sql', import.meta.url), 'utf8');
  await client.query(sql);
  console.log('Travel database constraints are ready');
} finally {
  await client.end();
}
