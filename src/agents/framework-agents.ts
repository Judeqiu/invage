/**
 * Maps the product roster to createFramework() agent entries.
 * Host (`invage`) is always first — defaultAgentId.
 */

import type { DomainExtension } from 'utarus';
import { invageExtension } from '../extension.js';
import { productHostLabel } from '../product-name.js';
import { aidealExtension } from './aideal.js';
import { bookkeeperExtension } from './bookkeeper.js';
import { factcheckerExtension } from './factchecker.js';
import { financialPlannerExtension } from './financial-planner.js';
import { investmentAdvisorExtension } from './investment-advisor.js';
import { optionsExpertExtension } from './options-expert.js';
import { realEstateExpertExtension } from './real-estate-expert.js';
import {
  HOST_AGENT_ID,
  PEER_CATALOG,
  type PeerId,
  type ProductProfileId,
  enabledPeerIds,
  readProductProfile,
} from './roster.js';

const PEER_EXTENSIONS: Record<PeerId, DomainExtension> = {
  bookkeeper: bookkeeperExtension,
  'financial-planner': financialPlannerExtension,
  'investment-advisor': investmentAdvisorExtension,
  'options-expert': optionsExpertExtension,
  aideal: aidealExtension,
  'real-estate-expert': realEstateExpertExtension,
  factchecker: factcheckerExtension,
};

export type FrameworkAgentEntry = {
  id: string;
  label: string;
  extension: DomainExtension;
};

export function buildFrameworkAgentList(
  profile: ProductProfileId = readProductProfile(),
): FrameworkAgentEntry[] {
  const host: FrameworkAgentEntry = {
    id: HOST_AGENT_ID,
    label: productHostLabel(),
    extension: invageExtension,
  };
  const peers: FrameworkAgentEntry[] = enabledPeerIds(profile).map((id) => ({
    id,
    label: PEER_CATALOG[id].label,
    extension: PEER_EXTENSIONS[id],
  }));
  return [host, ...peers];
}
