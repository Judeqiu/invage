/** Bound each HTTP request (including response-body reads), not an entire
 * multi-page history import. A timeout leaves the durable sync intent retryable. */
export function brokerRequestSignal(existing?: AbortSignal | null): AbortSignal {
  const timeout = AbortSignal.timeout(45_000);
  return existing ? AbortSignal.any([existing, timeout]) : timeout;
}
