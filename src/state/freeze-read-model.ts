/** Prevent one request from mutating a parsed read model shared by later requests. */
export function freezeReadModel<T>(value: T): T {
  const pending: unknown[] = [value];
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || Object.isFrozen(item)) continue;
    for (const child of Object.values(item)) pending.push(child);
    Object.freeze(item);
  }
  return value;
}
