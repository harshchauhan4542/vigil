import { openDb } from './db.js';

const handle = await openDb();
await handle.migrate();
console.log(`Migrations applied (${handle.driver}).`);
await handle.close();
