export interface StressInput {
  right: 'call' | 'put'; side: 'long' | 'short'; style: 'american' | 'european';
  spot: number; strike: number; days: number; iv: number; rate: number; dividendYield: number;
  premium: number; contracts: number; multiplier: number; horizon: number; equity: number;
  spotShock: number; ivShock: number; exitCost: number;
}
export interface StressScenario { spotShock: number; ivChange: number; price: number; pnl: number }
export interface StressResult {
  input: StressInput; horizon: number; modelPrice: number; scenarios: StressScenario[];
  worst: StressScenario; stressLoss: number; index: number; maximumLoss: number | null;
  unlimited: boolean; currentPremium: number; grossPutFunding: number | null;
  callDeliveryShares: number | null; expectedShortfall: null;
}
export function priceOption(input: Pick<StressInput, 'right' | 'style' | 'spot' | 'strike' | 'days' | 'iv' | 'rate' | 'dividendYield'>): number;
export function calculateRisk(input: StressInput): StressResult;
