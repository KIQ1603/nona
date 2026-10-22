import { createClient } from './connection.js';
import { migrate } from './migrate.js';
import { seed } from './seed.js';
import { upsertStaff } from './users.js';

const command = process.argv[2];
const client = createClient();
await client.connect();
try {
  if (command === 'reset') {
    if (process.env.NODE_ENV === 'production') throw new Error('reset is disabled in production');
    await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;');
    console.log('schema reset');
  }
  if (command === 'migrate' || command === 'reset') {
    const ran = await migrate(client);
    console.log(ran.length ? `applied: ${ran.join(', ')}` : 'database is up to date');
  }
  if (command === 'seed' || command === 'reset') {
    if (process.env.NODE_ENV === 'production') throw new Error('seed is disabled in production');
    await seed(client);
    console.log('seeded sample catalog');
  }
  if (command === 'create-staff') {
    // usage: create-staff <email> <role> [full name]; password is read from NONA_STAFF_PASSWORD (never argv/history)
    const [email, role, ...name] = process.argv.slice(3);
    const password = process.env.NONA_STAFF_PASSWORD;
    if (!email || !role || !password)
      throw new Error(
        'usage: NONA_STAFF_PASSWORD=... cli.ts create-staff <email> <ROLE> [full name]',
      );
    await upsertStaff(client, email, password, name.join(' ') || email, role);
    console.log(`staff account ready: ${email} (${role})`);
  }
  if (!['migrate', 'seed', 'reset', 'create-staff'].includes(command ?? '')) {
    throw new Error('usage: cli.ts <migrate|seed|reset|create-staff>');
  }
} finally {
  await client.end();
}
