/**
 * Vitest setup — set env vars BEFORE any module imports evaluate.
 *
 * Onboard modules read their env at module-load time, so the values must
 * exist before the test files import them. Vitest runs this file first.
 */

import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';

const TEST_DATA_ROOT = mkdtempSync(join(tmpdir(), 'invage-test-'));

process.env.UTARUS_LOADED_BY_HOST = '1';
process.env.UTARUS_DATA_ROOT = TEST_DATA_ROOT;
process.env.INVAGE_PUBLIC_LANDING_URL = 'https://test.example.com/onboard';
process.env.INVAGE_ONBOARD_TOKEN_TTL_MIN = '15';
process.env.INVAGE_SLACK_WORKSPACE_INVITE_URL =
  'https://join.slack.com/t/test-workspace/shared_invite/test-token';
process.env.UTARUS_REPORTS_URL = 'http://test.example.com/reports';
