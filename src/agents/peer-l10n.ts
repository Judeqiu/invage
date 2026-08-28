/**
 * Minimum DomainExtension.l10n for specialist peers (utarus ≥ 3.0.0-beta.49).
 * Peers have no WebUI chrome; the host overlay lives in /l10n.
 */
import type { DomainL10nConfig } from 'utarus';

export const PEER_L10N: DomainL10nConfig = {
  defaultLanguage: 'en',
  languages: ['en'],
};
