
export function formatPrice(value?: number | null): string {
  if (value === undefined || value === null) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
