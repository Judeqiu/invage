/**
 * Local specialist roster for this Invage instance.
 *
 * Profile is an explicit product config (`INVAGE_PRODUCT_PROFILE`), not a
 * keyword match on the display name. Missing or unknown values fail fast.
 */

export const HOST_AGENT_ID = 'invage' as const;

export const PEER_CATALOG = {
  bookkeeper: {
    id: 'bookkeeper',
    label: 'Bookkeeper',
    capability:
      'Ledger integrity: journal, import/reconcile, cash/FD sleeves, holding mutations, household writes',
  },
  'financial-planner': {
    id: 'financial-planner',
    label: 'FinancialPlanner',
    capability:
      'Payment efficiency: multi-combination paydown search (min HARD cost / max gain), deposit-vs-debt, opportunity-cost math',
  },
  'investment-advisor': {
    id: 'investment-advisor',
    label: 'InvestmentAdvisor',
    capability:
      'Securities research & recommendations: portfolio evaluation, idea discovery, single-name thesis, news→path, live marks, analysis reports — not listed options structure',
  },
  'options-expert': {
    id: 'options-expert',
    label: 'OptionsExpert',
    capability:
      'Listed options insight: calls/puts structure, moneyness, time value, IV/OI when sourced, defined vs undefined risk, covered call / protective put / cash-secured short put. Not equity thesis craft',
  },
  aideal: {
    id: 'aideal',
    label: 'AIDeal',
    capability:
      'Aideal Investment production: sleeve index vs sector ETF, weekly five-section pack, Gmail-safe newsletter. Not generic thesis craft',
  },
  'real-estate-expert': {
    id: 'real-estate-expert',
    label: 'RealEstateExpert',
    capability:
      'Physical property: comps, stamp duties, yield/LTV, home marks, property ledger, second-property all-in, SG RE affordability with duties, URA car parks',
  },
  factchecker: {
    id: 'factchecker',
    label: 'Factchecker',
    capability:
      'Integrity audit of material claims before final host answer: re-run tools, `submit_factcheck_verdict` PASS/FAIL/PASS_WITH_CAVEATS, propose REDO — does **not** craft plans/theses/journals',
  },
} as const;

export type PeerId = keyof typeof PEER_CATALOG;

export const PRODUCT_PROFILES = {
  full: [
    'bookkeeper',
    'financial-planner',
    'investment-advisor',
    'options-expert',
    'real-estate-expert',
    'aideal',
    'factchecker',
  ],
  consultant: ['bookkeeper', 'investment-advisor', 'options-expert', 'factchecker'],
} as const;

export type ProductProfileId = keyof typeof PRODUCT_PROFILES;

export function parseProductProfile(raw: string | undefined): ProductProfileId {
  if (raw === undefined || raw.trim() === '') {
    throw new Error(
      'INVAGE_PRODUCT_PROFILE is required. Expected: full | consultant.',
    );
  }
  const id = raw.trim();
  if (id !== 'full' && id !== 'consultant') {
    throw new Error(
      `Unknown INVAGE_PRODUCT_PROFILE "${id}". Expected: full | consultant.`,
    );
  }
  return id;
}

export function readProductProfile(): ProductProfileId {
  return parseProductProfile(process.env.INVAGE_PRODUCT_PROFILE);
}

export function enabledPeerIds(profile: ProductProfileId): readonly PeerId[] {
  return PRODUCT_PROFILES[profile];
}

export function peerEnabled(profile: ProductProfileId, id: PeerId): boolean {
  return (PRODUCT_PROFILES[profile] as readonly string[]).includes(id);
}

export function craftPeerIds(profile: ProductProfileId): PeerId[] {
  return enabledPeerIds(profile).filter((id) => id !== 'factchecker');
}

export function craftPeerLabels(profile: ProductProfileId): string {
  return craftPeerIds(profile)
    .map((id) => PEER_CATALOG[id].label)
    .join(' / ');
}

export function specialistTableMarkdown(profile: ProductProfileId): string {
  const header =
    '| Peer | id | Capability — route when intent fits |\n|------|-----|--------------------------------------|';
  const rows = enabledPeerIds(profile).map((id) => {
    const p = PEER_CATALOG[id];
    return `| **${p.label}** | \`${p.id}\` | ${p.capability} |`;
  });
  return `${header}\n${rows.join('\n')}`;
}

/** @Label if installed; otherwise host — never invent a missing specialist. */
export function specialistHandoffLabel(
  profile: ProductProfileId,
  peerId: PeerId,
  hostLabel: string,
): string {
  if (peerEnabled(profile, peerId)) {
    return `**@${PEER_CATALOG[peerId].label}**`;
  }
  return `**@${hostLabel}** (specialist \`${peerId}\` is not installed on this product — do not invent that craft)`;
}

export function redoTargetIds(profile: ProductProfileId): string[] {
  return [...craftPeerIds(profile), HOST_AGENT_ID];
}

export function redoTargetRule(profile: ProductProfileId): string {
  const ids = redoTargetIds(profile)
    .map((id) => `\`${id}\``)
    .join(', ');
  return (
    `**REDO.target** must be one of: ${ids}. ` +
    `Never name a specialist that is not installed on this product.`
  );
}

export function hostNeverDoYourself(profile: ProductProfileId): string {
  const lines: string[] = [];
  if (peerEnabled(profile, 'bookkeeper')) {
    lines.push(
      '- **Any books write/update** (portfolio CRUD, cash/FD, household ledger, scenarios, snapshots) → **Bookkeeper only**',
    );
  }
  if (peerEnabled(profile, 'financial-planner')) {
    lines.push(
      '- Debt paydown / opportunity-cost schedules → **FinancialPlanner** (reads books; does not journal)',
    );
  }
  if (peerEnabled(profile, 'investment-advisor')) {
    lines.push(
      '- Quotes, valuation, securities discovery/thesis, news path → **InvestmentAdvisor**',
    );
  }
  if (peerEnabled(profile, 'options-expert')) {
    lines.push(
      '- Listed calls/puts, chain, IV/premium structure, covered call / protective put / short-premium risk → **OptionsExpert**',
    );
  }
  if (peerEnabled(profile, 'aideal')) {
    lines.push(
      '- Aideal sleeve index / weekly pack / production newsletter → **AIDeal**',
    );
  }
  if (peerEnabled(profile, 'real-estate-expert')) {
    lines.push(
      '- Property comps, duties, yield, RE research, car parks → **Real Estate Expert** (property **marks/payments** still → **Bookkeeper**)',
    );
  }
  if (peerEnabled(profile, 'factchecker')) {
    lines.push(
      '- Integrity audit of material claims → **Factchecker** (always-last; you do not freehand re-audit)',
    );
  }
  lines.push(
    '- Do not claim “I can handle that myself” when a peer owns the capability',
  );
  if (profile === 'consultant') {
    lines.push(
      '- **Not installed on this product:** payment-plan optimizer, Aideal production, physical-RE comps/duties. Do not `invoke_local_agent` / `handoff_to_agent` to `financial-planner`, `aideal`, or `real-estate-expert`. Closest installed fit: Bookkeeper (ledger / household writes), InvestmentAdvisor (securities), or OptionsExpert (listed calls/puts). If none fit, say the specialist is not on this product — do not DIY the missing craft.',
    );
  }
  return lines.join('\n');
}

export function hostScopeIn(profile: ProductProfileId): string {
  if (profile === 'consultant') {
    return (
      'craft peers (Bookkeeper, InvestmentAdvisor, OptionsExpert) + Factchecker + residual host tools ' +
      '(playbook config, read-only household/projection) + **scheduled follow-ups** via `create_task` when work needs time'
    );
  }
  return (
    'craft peers + Factchecker + residual host tools (books, payments, securities research, physical RE, non-property cash path, playbook config) + **scheduled follow-ups** via `create_task` when work needs time'
  );
}

export function hostScopeOut(profile: ProductProfileId): string {
  const extra =
    profile === 'consultant'
      ? 'Aideal production; payment-plan optimizer; physical RE comps/duties (not installed); '
      : '';
  return (
    extra +
    'tax/licensed advice as advice; trade execution; multi-unit listing shopping packs (offer single-unit path); topics with no household/market/property link. Everything else → action plan, not a brush-off.'
  );
}
