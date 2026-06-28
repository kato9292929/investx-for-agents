/**
 * Tolerant object-tree helpers for defensive parsing.
 *
 * Adapted from the upstream AA repo's signal-extract walk. The live response
 * shapes of the Yield / Portfolio endpoints are not confirmed (TODO schema), so
 * parsing searches the whole object tree for documented field names plus a few
 * obvious variants, and never invents a value when nothing is found.
 */

export function asNumber(val: unknown): number | undefined {
  if (typeof val === "number" && Number.isFinite(val)) return val;
  if (typeof val === "string" && val.trim() !== "") {
    // tolerate "12.5%", "$1,200,000"
    const cleaned = val.replace(/[%$,\s]/g, "");
    const n = Number(cleaned);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

export function asString(val: unknown): string | undefined {
  return typeof val === "string" && val.trim() !== "" ? val : undefined;
}

/** Breadth-first walk over plain objects/arrays, yielding every object node. */
export function* walkObjects(root: unknown): Generator<Record<string, unknown>> {
  const queue: unknown[] = [root];
  let guard = 0;
  while (queue.length > 0 && guard < 5000) {
    guard++;
    const node = queue.shift();
    if (Array.isArray(node)) {
      for (const item of node) queue.push(item);
    } else if (node !== null && typeof node === "object") {
      const obj = node as Record<string, unknown>;
      yield obj;
      for (const v of Object.values(obj)) {
        if (v !== null && typeof v === "object") queue.push(v);
      }
    }
  }
}

/** First present, non-null key from `keys` (case-insensitive). */
export function firstKey(
  obj: Record<string, unknown>,
  keys: string[]
): { key: string; value: unknown } | undefined {
  const lowerMap = new Map<string, string>();
  for (const k of Object.keys(obj)) lowerMap.set(k.toLowerCase(), k);
  for (const want of keys) {
    const actual = lowerMap.get(want.toLowerCase());
    if (actual !== undefined && obj[actual] !== null && obj[actual] !== undefined) {
      return { key: actual, value: obj[actual] };
    }
  }
  return undefined;
}
