/** Retry only known optimistic-revision conflicts, never arbitrary persistence errors. */
export function isInvestorRevisionConflict(error: unknown): boolean {
  return error instanceof Error && [
    'Investor state changed during this update; reload before saving.',
    'User revision conflict or user not found',
  ].includes(error.message);
}
