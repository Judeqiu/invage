export type TigerHttpMethod = 'accounts' | 'positions' | 'assets' | 'prime_assets';

export interface TigerGatewayEnvelope {
  code: number | string;
  message?: string;
  data: unknown;
  timestamp?: string | number;
  sign?: string;
}

export interface TigerRawBundle {
  schema: 'invage.tiger.raw.v1';
  fetched_at: string;
  gateway: string;
  account: string;
  license: string;
  account_kind: 'global' | 'prime' | 'paper';
  managed_accounts: TigerGatewayEnvelope | null;
  assets: { method: 'assets' | 'prime_assets'; envelope: TigerGatewayEnvelope };
  positions: {
    STK: TigerGatewayEnvelope;
    OPT: TigerGatewayEnvelope;
    FUND: TigerGatewayEnvelope;
  };
}

export function envelopeOk(env: TigerGatewayEnvelope): boolean {
  return env.code === 0 || env.code === '0';
}
