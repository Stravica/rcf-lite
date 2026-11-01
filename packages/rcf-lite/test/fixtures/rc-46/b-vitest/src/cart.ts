export function applyDiscount(total: number, pct: number): number {
  return Math.round(total * (100 - pct)) / 100;
}
