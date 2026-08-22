/**
 * Wallet Street Flex egress IPv4 for IBKR Client Portal IP restriction copy.
 * Unset/empty → null (leave Valid for IP blank). Bad value throws at boot.
 */

const IPV4 =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)$/;

export function readFlexEgressIpv4(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const raw = env.INVAGE_FLEX_EGRESS_IPV4;
  if (raw == null) return null;
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (!IPV4.test(trimmed)) {
    throw new Error(
      `INVAGE_FLEX_EGRESS_IPV4 must be a dotted-quad IPv4 (got ${JSON.stringify(raw)}).`,
    );
  }
  return trimmed;
}
