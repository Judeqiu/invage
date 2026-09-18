export const WEBULL_REGIONS = ['us', 'hk', 'jp', 'sg', 'th', 'au', 'my', 'uk', 'eu'] as const;
export type WebullRegion = (typeof WEBULL_REGIONS)[number];

export const WEBULL_API_HOSTS: Record<WebullRegion, string> = {
  us: 'api.webull.com',
  hk: 'api.webull.hk',
  jp: 'api.webull.co.jp',
  sg: 'api.webull.com.sg',
  th: 'api.webull.co.th',
  au: 'api.webull.com.au',
  my: 'api.webull.com.my',
  uk: 'api.webull-uk.com',
  eu: 'api.webull.eu',
};

export const WEBULL_ALLOW_HOSTS = new Set(Object.values(WEBULL_API_HOSTS));

export interface WebullRawBundle {
  schema: 'invage.webull.raw.v1';
  fetched_at: string;
  region: WebullRegion;
  host: string;
  account_id: string;
  accounts: unknown;
  balances: unknown;
  positions: unknown;
}
