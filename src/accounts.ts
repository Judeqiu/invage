/** Shared accounts are explicitly configured; partial configuration fails closed. */
export function readAccountConfiguration(env: NodeJS.ProcessEnv) {
  const mode = env.UTARUS_ACCOUNTS_MODE ?? 'local';
  if (mode === 'local') return { mode: 'local' as const };
  if (mode !== 'shared') throw new Error('UTARUS_ACCOUNTS_MODE must be local or shared');
  const required = (name: string) => {
    const value = env[name]?.trim();
    if (!value) throw new Error(`${name} is required in shared account mode`);
    return value;
  };
  const endpoint = required('UTARUS_SHARED_ENDPOINT');
  const url = new URL(endpoint);
  if (url.username || url.password || url.search || url.hash ||
      !(url.protocol === 'https:' || url.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname))) {
    throw new Error('Shared authority requires HTTPS or loopback HTTP');
  }
  required('UTARUS_SHARED_AGENT_CREDENTIAL');
  return { mode: 'shared' as const, endpoint,
    authorityId: required('UTARUS_SHARED_AUTHORITY_ID'),
    agentId: required('UTARUS_SHARED_AGENT_ID'),
    credentialRef: 'UTARUS_SHARED_AGENT_CREDENTIAL' };
}
