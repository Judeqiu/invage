/** Prevent one request from mutating a parsed read model shared by later requests. */
const frozenReadModels=new WeakSet<object>();
export const isFrozenReadModel=(value:object)=>frozenReadModels.has(value);
export function freezeReadModel<T>(value: T): T {
  const pending: unknown[] = [value];
  const seen=new WeakSet<object>();
  while (pending.length) {
    const item = pending.pop();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const child of Object.values(item)) pending.push(child);
    Object.freeze(item);
  }
  if(value && typeof value==='object')frozenReadModels.add(value);
  return value;
}
