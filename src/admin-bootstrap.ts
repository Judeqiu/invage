/** Validate migrated administrator identities; startup never invents user records. */
import { getDatabaseRuntime } from 'utarus/database';

export async function ensureAdminUsersExist(): Promise<void> {
  const users = getDatabaseRuntime().users;
  for (const [provider, variable] of [['telegram', 'TELEGRAM_ADMIN_IDS'], ['slack', 'SLACK_ADMIN_IDS']] as const) {
    const configured = process.env[variable];
    if (configured === undefined || configured.trim() === '') continue;
    for (const entry of configured.split(',')) {
      const identity = entry.trim();
      if (!identity || (provider === 'telegram' && (!Number.isSafeInteger(Number(identity)) || Number(identity) <= 0))) {
        throw new Error(`Invalid identity in ${variable}`);
      }
      const snapshot = await users.findByExternalIdentity(provider, identity, 'all');
      if (snapshot === null || snapshot.state.user.deleted_at !== undefined) {
        throw new Error(`Configured ${provider} administrator has no active migrated user record`);
      }
    }
  }
}
