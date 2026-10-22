/** 1.250.000 -> "1,25tr", 12.500.000 -> "12,5tr", 950.000 -> "950k". Compact money for chart axes. */
export function shortVnd(v: number): string {
  if (v >= 1_000_000_000) return `${(v / 1_000_000_000).toFixed(1).replace('.', ',')}tỷ`;
  if (v >= 1_000_000)
    return `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1).replace('.', ',')}tr`;
  if (v >= 1_000) return `${Math.round(v / 1_000)}k`;
  return String(v);
}
