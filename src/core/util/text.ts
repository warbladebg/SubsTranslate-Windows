/** Collapses whitespace and control characters, trims, and caps the length of untrusted text. */
export function cleanText(value: string, maxLength = 500): string {
  return value.replace(/[\r\n\0]+/g, " ").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

/** Deterministic, non-zero 32-bit FNV-1a hash, used to derive numeric ids from strings. */
export function stableNumericId(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) || 1;
}
