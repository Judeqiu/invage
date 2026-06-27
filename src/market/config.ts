export const COMPANIES: Record<string, string> = {
  // Technology
  QQQ: 'Invesco QQQ Trust', TSLA: 'Tesla Inc', MSFT: 'Microsoft Corp',
  AAPL: 'Apple Inc', META: 'Meta Platforms Inc', GOOGL: 'Alphabet Inc',
  // Utilities
  NEE: 'NextEra Energy', SO: 'Southern Company', CEG: 'Constellation Energy',
  DUK: 'Duke Energy', VST: 'Vistra Corp', AEP: 'American Electric Power',
  SRE: 'Sempra Energy', D: 'Dominion Energy', EXC: 'Exelon Corp',
  PEG: 'Public Service Enterprise', XEL: 'Xcel Energy', ED: 'Consolidated Edison',
  EIX: 'Edison International', PPL: 'PPL Corp', WEC: 'WEC Energy',
  CMS: 'CMS Energy', AES: 'AES Corp', NRG: 'NRG Energy', AVA: 'Avista Corp',
  // Healthcare
  LLY: 'Eli Lilly', JNJ: 'Johnson & Johnson', ABBV: 'AbbVie Inc',
  UNH: 'UnitedHealth', ABT: 'Abbott Laboratories', MRK: 'Merck & Co',
  TMO: 'Thermo Fisher Scientific', ISRG: 'Intuitive Surgical', AMGN: 'Amgen Inc',
  BSX: 'Boston Scientific', GILD: 'Gilead Sciences', PFE: 'Pfizer Inc',
  SYK: 'Stryker Corp', DHR: 'Danaher Corp', MDT: 'Medtronic',
  VRTX: 'Vertex Pharmaceuticals', BMY: 'Bristol-Myers Squibb', CI: 'Cigna Group',
  // Aerospace
  GE: 'General Electric Co', BA: 'Boeing Co', RTX: 'RTX Corp',
  LMT: 'Lockheed Martin Corp', NOC: 'Northrop Grumman Corp', GD: 'General Dynamics Corp',
  HON: 'Honeywell International', LHX: 'L3Harris Technologies', AXON: 'Axon Enterprise',
  HWM: 'Howmet Aerospace', PH: 'Parker-Hannifin Corp', TDG: 'TransDigm Group',
  ETN: 'Eaton Corp', ESLT: 'Elbit Systems', HEI: 'HEICO Corp',
  LDOS: 'Leidos Holdings', BWXT: 'BWX Technologies', CW: 'Curtiss-Wright Corp',
  // Food Staples
  COST: 'Costco Wholesale', WMT: 'Walmart Inc', PG: 'Procter & Gamble',
  KO: 'Coca-Cola Co', PEP: 'PepsiCo Inc', MDLZ: 'Mondelez International',
  CL: 'Colgate-Palmolive', MNST: 'Monster Beverage', KR: 'Kroger Co',
  TGT: 'Target Corp', KDP: 'Keurig Dr Pepper', KMB: 'Kimberly-Clark',
  KVUE: 'Kenvue Inc', SYY: 'Sysco Corp', GIS: 'General Mills',
  ADM: 'Archer-Daniels-Midland', DG: 'Dollar General', HSY: 'Hershey Co',
  CHD: 'Church & Dwight',
  // Financial
  'BRK-B': 'Berkshire Hathaway',
};

export const BENCHMARKS: Record<string, string> = {
  'Overall Portfolio': 'SPY',
  'SL Financial S1': 'SPY',
  'SL Healthcare S1': 'IYH',
  'SL Aerospace S1': 'ITA',
  'SL Food Staples S1': 'VDC',
  'SL Utility S1': 'XLU',
  'SL Technology S1': 'QQQ',
};

export const THRESHOLDS = {
  buyMinUpsidePct: 15,
  strongBuyUpsidePct: 30,
  pegAttractive: 1.5,
  peAttractive: 25,
  roeGood: 0.15,
} as const;
