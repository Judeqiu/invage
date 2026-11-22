/** Pure calculations. Quotes and fees use native currency; no FX or tax basis is inferred. */
export interface OptionQuote {
  source: string;
  collectedAt: string;
  bookAsOf: string | null;
  snapshotAsOf?: string | null;
  snapshotDate?: string | null;
  lastTradeAt: string | null;
  greeksSource?: string;
  greeksCollectedAt?: string | null;
  bid: number | null;
  ask: number | null;
  bidSize: number | null;
  askSize: number | null;
  volume: number | null;
  openInterest: number | null;
  ivPercent: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  vega: number | null;
  rho: number | null;
}
export interface StockQuote {
  price: number;
  currency: string;
  asOf: string;
  source: string;
  field: string;
}
export interface ListedOption {
  id: string;
  underlying: string;
  right: 'put' | 'call';
  strike: number;
  expiry: string;
  premiumMultiplier: number | null;
  shares: number | null;
  currency: string;
  exercise: 'american' | 'european' | null;
  /** Verified share-only deliverable, in the named underlying. */
  shareOnly: boolean;
  source: string;
  quote: OptionQuote;
}
export interface PositionCash {
  openGross: number | null;
  openFees: number | null;
  originalGross: number | null;
  chainGross: number | null;
  chainFees: number | null;
}
export interface DecisionPosition {
  currency: string;
  strike: number;
  expiry: string;
  quantity: number;
  listed: ListedOption | null;
}
export interface FeeEstimate {
  currency: string;
  feePerContract: number;
  minimumOrderFee: number;
  reference: string;
}

export const ABOVE_STRIKE_PERCENT = 10;
const CLOSE_PREMIUM_FACTOR = 2;
export function triggerCeiling(strike: number) {
  const [mantissa, exponent = '0'] = String(strike).split('e');
  const [whole, fraction = ''] = mantissa.split('.');
  const scaled = BigInt(whole + fraction) * BigInt(100 + ABOVE_STRIKE_PERCENT);
  // Scale in decimal so a quote exactly at the approval boundary is included.
  return Number(`${scaled}e${Number(exponent) - fraction.length - 2}`);
}
export const stockMovePercent = (spot: number, strike: number) => (spot - strike) * 100 / strike;
const differenceInDays = (from: string, to: string) => (Date.parse(to) - Date.parse(from)) / 86_400_000;
export const knownSum = (...items: (number | null)[]) =>
  items.every((item): item is number => item !== null) ? items.reduce((sum, item) => sum + item, 0) : null;
const negative = (value: number | null) => value === null ? null : -value;
const times = (value: number | null, units: number | null) => value === null || units === null ? null : value * units;
const cashAtQuote = (option: ListedOption, side: 'bid' | 'ask', contracts: number) => {
  const quote = option.quote;
  // Preserve the raw book in the report. An empty depth, crossed book, or zero bid
  // does not establish a fill. A last trade's time is never a book timestamp.
  const price = quote[side];
  if (price === null || price <= 0 || quote.bid !== null && quote.ask !== null && quote.bid > quote.ask ||
      (side === 'bid' ? quote.bidSize : quote.askSize) === 0) return null;
  return times(price, times(option.premiumMultiplier, contracts));
};
const estimatedFee = (model: FeeEstimate | undefined, currency: string, size: number) =>
  model?.currency === currency ? Math.max(model.minimumOrderFee, model.feePerContract * size) : null;

export function analyzeDecision(position: DecisionPosition, cash: PositionCash, stock: StockQuote | null,
  candidates: ListedOption[], date: string, feeEstimate?: FeeEstimate) {
  const { listed, currency, quantity, strike, expiry } = position;
  const openNet = knownSum(cash.openGross, cash.openFees);
  const net = knownSum(cash.chainGross, cash.chainFees);
  const delivered = listed?.shareOnly ? times(listed.shares, quantity) : null;
  const assignmentCash = times(delivered, strike);
  const spot = stock?.currency === currency ? stock.price : null;
  const intrinsic = spot === null ? null : Math.max(strike - spot, 0);
  const buyback = listed ? cashAtQuote(listed, 'ask', quantity) : null;
  const fee = estimatedFee(feeEstimate, currency, quantity);
  const atExpiry = (price: number) => knownSum(net, negative(times(delivered, Math.max(strike - price, 0))));
  const close = {
    buyback, feeEstimate: fee,
    thisGrossBeforeFutureFees: knownSum(cash.openGross, negative(buyback)),
    thisNetBeforeFutureFees: knownSum(openNet, negative(buyback)),
    thisNetWithEstimatedFee: knownSum(openNet, negative(buyback), negative(fee)),
    chainGrossBeforeFutureFees: knownSum(cash.chainGross, negative(buyback)),
    chainNetBeforeFutureFees: knownSum(net, negative(buyback)),
    chainNetWithEstimatedFee: knownSum(net, negative(buyback), negative(fee)),
    preferredUnder: cash.originalGross !== null && cash.originalGross > 0 ? cash.originalGross * CLOSE_PREMIUM_FACTOR : null,
  };

  const hold = {
    delivered, assignmentCash, openNet, cumulativeNetCash: net,
    breakeven: delivered && net !== null ? strike - net / delivered : null,
    intrinsic,
    timeValueAtAsk: buyback !== null && intrinsic !== null && listed?.premiumMultiplier
      ? buyback / (quantity * listed.premiumMultiplier) - intrinsic : null,
    currentLegPnlAtAsk: close.thisNetBeforeFutureFees, chainPnlAtAsk: close.chainNetBeforeFutureFees,
    expiryAtStrike: atExpiry(strike), expiryAtSpot: spot === null ? null : atExpiry(spot),
    expiryAtZero: atExpiry(0),
    daysToExpiry: differenceInDays(date, expiry),
  };

  const comparable = (item: ListedOption) =>
    item.shareOnly && item.currency === currency && listed !== null && item.underlying === listed.underlying;
  const rolls = candidates.filter(item => item.right === 'put' && item.id !== listed?.id && item.expiry >= date).map(option => {
    const shares = comparable(option) && option.exercise === 'american' ? times(option.shares, quantity) : null;
    const newIncome = shares !== null ? cashAtQuote(option, 'bid', quantity) : null;
    const grossFlow = knownSum(negative(buyback), newIncome);
    const netFlowEstimate = knownSum(grossFlow, negative(fee), negative(fee));
    const chainNet = knownSum(net, grossFlow);
    return { option, shares, newIncome, grossFlow, netFlowEstimate,
      assignmentCash: times(shares, option.strike), daysToExpiry: differenceInDays(date, option.expiry),
      additionalDays: differenceInDays(expiry, option.expiry), chainNetBeforeFutureFees: chainNet,
      breakeven: shares && chainNet !== null ? option.strike - chainNet / shares : null,
      breakevenWithEstimatedFees: shares && chainNet !== null && fee !== null ? option.strike - (chainNet - 2 * fee) / shares : null };
  });
  // Same-day calls are kept as evidence. Delivery must occur before their sale
  // and before they expire, even if an early put assignment occurs.
  const calls = candidates.filter(item => item.right === 'call' && item.expiry >= date).map(option => {
    const contracts = comparable(option) && delivered !== null && option.shares !== null && option.shares > 0
      ? Math.floor(delivered / option.shares) : null;
    const covered = contracts === null ? null : times(option.shares, contracts);
    const leftover = delivered === null || covered === null ? null : delivered - covered;
    const income = contracts ? cashAtQuote(option, 'bid', contracts) : null;
    const callFee = contracts ? estimatedFee(feeEstimate, currency, contracts) : null;
    const initialCash = knownSum(net, negative(assignmentCash), income);
    const calledPnl = (remainingSharePrice: number) =>
      knownSum(initialCash, times(covered, option.strike), times(leftover, remainingSharePrice));
    const ifCalled = leftover === 0 ? calledPnl(0) : spot === null ? null : calledPnl(spot);
    const ifNotCalled = spot === null ? null : knownSum(initialCash, times(delivered, spot));
    return { option, contracts, covered, leftover, income, feeEstimate: callFee,
      ifCalled, ifCalledWithEstimatedFee: knownSum(ifCalled, negative(callFee)),
      ifNotCalledAtScanSpot: ifNotCalled, ifNotCalledAtZero: initialCash,
      ifNotCalledAtScanSpotFeasibleAtExpiry: spot === null ? null : spot <= option.strike,
      upCap: leftover === 0 ? ifCalled : null };
  });
  return { hold, close: { ...close, highlight: buyback !== null && close.preferredUnder !== null && buyback < close.preferredUnder },
    calls, rolls, feeReference: feeEstimate?.currency === currency ? feeEstimate.reference : null };
}
