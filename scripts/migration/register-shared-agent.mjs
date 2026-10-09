import pg from 'pg';
import { SharedAccountStore } from '../../node_modules/utarus/dist/accounts/shared-store.js';
for (const name of ['UTARUS_SHARED_DATABASE_URL','UTARUS_SHARED_AUTHORITY_ID','UTARUS_SHARED_AGENT_ID','UTARUS_SHARED_AGENT_CREDENTIAL','UTARUS_SHARED_AGENT_ORIGIN']) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}
const pool = new pg.Pool({ connectionString: process.env.UTARUS_SHARED_DATABASE_URL });
try {
  const store = new SharedAccountStore(pool, process.env.UTARUS_SHARED_AUTHORITY_ID, null);
  await store.registerAgent({ agentId: process.env.UTARUS_SHARED_AGENT_ID,
    credential: process.env.UTARUS_SHARED_AGENT_CREDENTIAL, redirectOrigin: process.env.UTARUS_SHARED_AGENT_ORIGIN });
  console.log('Shared agent credential registered');
} finally { await pool.end(); }
