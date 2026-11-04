import { randomUUID } from 'node:crypto';
import { readAgentConfig } from 'utarus';
import { dashboardConfig } from '../webapp/dashboard-config.js';

/** Read the administrator's setting at issuance time; managers cannot override it. */
export function configuredInvitationCode(): string {
  const prefix = String(readAgentConfig(dashboardConfig).invitation_code_prefix).trim().toUpperCase() || 'IC';
  return `${prefix}-${randomUUID().slice(0, 8).toUpperCase()}`;
}
