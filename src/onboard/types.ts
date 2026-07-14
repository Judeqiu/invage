/**
 * Onboard flow types — public registration → Slack handshake.
 *
 * Tokens live at data/onboard_tokens.yaml. Same pattern as Binary's QR
 * onboard, but the channel is Slack (workspace invite + /bind) instead of Telegram.
 */

export type OnboardStatus = 'pending' | 'used' | 'rejected';

export interface OnboardToken {
  token: string;                    // BIND-XXXXXXXX
  display_name: string;             // raw, as entered on the form
  email_submitted: string;          // contact email, advisory + stored on profile
  created_at: string;               // ISO 8601 UTC
  expires_at: string;               // ISO 8601 UTC
  status: OnboardStatus;
  // populated when status === 'used':
  used_by_slack?: string;           // Slack user id (U…)
  used_at?: string;                 // YYYY-MM-DD
  slug?: string;                    // user slug created
  // populated when status === 'rejected':
  rejected_at?: string;
  rejected_by?: string;             // admin Slack user id
  rejected_reason?: string;
}

export interface RegistrationRequest {
  display_name: string;
  email: string;
}

export interface RegistrationResponse {
  token: string;
  /** Shared Slack workspace invite URL (join the space). */
  workspace_invite_url: string;
  bind_command: string;
  expires_at: string;
}

export class ValidationError extends Error {
  constructor(public field: string, message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
