import { describe, it, expect } from 'vitest';
import { readAccountConfiguration } from '../src/accounts.js';

describe('account authority configuration', () => {
  const shared = { UTARUS_ACCOUNTS_MODE: 'shared', UTARUS_SHARED_ENDPOINT: 'http://127.0.0.1:3330',
    UTARUS_SHARED_AUTHORITY_ID: 'velovest', UTARUS_SHARED_AGENT_ID: 'velovest',
    UTARUS_SHARED_AGENT_CREDENTIAL: 'private-credential' };
  it('keeps unconfigured instances local', () => {
    expect(readAccountConfiguration({})).toEqual({ mode: 'local' });
  });
  it('rejects partial configuration and public plaintext transport', () => {
    expect(() => readAccountConfiguration({ ...shared, UTARUS_SHARED_AGENT_CREDENTIAL: '' })).toThrow();
    expect(() => readAccountConfiguration({ ...shared, UTARUS_SHARED_ENDPOINT: 'http://public.example' })).toThrow();
    expect(() => readAccountConfiguration({ UTARUS_ACCOUNTS_MODE: 'invalid' })).toThrow();
  });
  it('passes identity and a credential reference without copying the secret', () => {
    const config = readAccountConfiguration(shared);
    expect(config).toMatchObject({ mode: 'shared', authorityId: 'velovest', agentId: 'velovest' });
    expect(JSON.stringify(config)).not.toContain('private-credential');
  });
});
