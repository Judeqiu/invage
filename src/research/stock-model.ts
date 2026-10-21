import { Type, type Static } from 'typebox';

export const sourceSchema = Type.Object({
  id: Type.String({ minLength: 1, maxLength: 60, pattern: '^web:[a-z0-9-]{1,55}$' }), title: Type.String({ minLength: 1, maxLength: 180 }),
  url: Type.String({ minLength: 8, maxLength: 1500 }), date: Type.String({ minLength: 1, maxLength: 80 }),
  evidence: Type.String({ minLength: 1, maxLength: 500 }),
}, { additionalProperties: false });
export const claimSchema = Type.Object({
  text: Type.String({ minLength: 1, maxLength: 1600 }),
  sourceIds: Type.Array(Type.String({ minLength: 1, maxLength: 60 }), { minItems: 1, maxItems: 8 }),
}, { additionalProperties: false });
const claims = () => Type.Array(claimSchema, { maxItems: 6 });
export const discoverySchema = Type.Object({
  sources: Type.Array(sourceSchema, { maxItems: 12 }),
  business: claims(), competition: claims(), developments: claims(),
  peers: Type.Array(Type.Object({ ticker: Type.String({ minLength: 1, maxLength: 20 }),
    rationale: Type.String({ minLength: 1, maxLength: 400 }) }, { additionalProperties: false }), { maxItems: 6 }),
  gaps: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 12 }),
}, { additionalProperties: false });
export const analysisSchema = Type.Object({
  conclusion: claimSchema, thesis: claims(), financials: claims(), valuation: claims(),
  catalysts: claims(), risks: claims(),
  gaps: Type.Array(Type.String({ maxLength: 500 }), { maxItems: 12 }),
}, { additionalProperties: false });
export const auditSchema = Type.Object({ approved: Type.Boolean(),
  findings: Type.Array(Type.String({ maxLength: 1000 }), { maxItems: 12 }),
}, { additionalProperties: false });
export type ResearchSource = Static<typeof sourceSchema>;
export type ResearchClaim = Static<typeof claimSchema>;
export type ResearchDiscovery = Static<typeof discoverySchema>;
export type ResearchAnalysis = Static<typeof analysisSchema>;

export function publicSourceUrl(value: string): string | null {
  try {
    const u = new URL(value);
    if (!['https:', 'http:'].includes(u.protocol) || u.username || u.password) return null;
    return u.href;
  } catch { return null; }
}
/** References must resolve to the exact evidence bundle, never invented footnotes. */
export function assertResearchReferences(claims: ResearchClaim[], sources: ResearchSource[]): void {
  const ids = new Set(sources.map(s => s.id));
  if (ids.size !== sources.length) throw new Error('Research source IDs must be unique.');
  if (sources.some(s => !publicSourceUrl(s.url))) throw new Error('Research evidence contains an invalid source URL.');
  for (const c of claims) if (!c.sourceIds.length || c.sourceIds.some(id => !ids.has(id)))
    throw new Error('A research claim cites evidence outside this run.');
}
