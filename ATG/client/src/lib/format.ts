/** Shared display helpers. */

/**
 * Formats a price/value for display. Prices can be large integers (synthetic
 * indices) or precise decimals (FX/metals), so we never round to a fixed
 * number of places — we only cap the maximum fraction digits.
 */
export function formatPrice(value?: number | null): string {
  if (value === undefined || value === null) return '—';
  return value.toLocaleString('en-US', { maximumFractionDigits: 6 });
}
