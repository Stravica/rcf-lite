export function sumTotals(items: number[]): number {
  let total = 0;
  for (const n of items) total += n;
  return total;
}
