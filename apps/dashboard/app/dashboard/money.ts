const precision: Record<string, number> = { KES: 2, USD: 2, AED: 2, USDC: 6, USDT: 6, BTC: 8, ETH: 18 };

export function formatMinor(amount: string | null | undefined, asset: string): string {
  if (amount == null || !/^\-?\d+$/.test(amount)) return '—';
  const scale = precision[asset] ?? 2;
  const value = BigInt(amount);
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const base = 10n ** BigInt(scale);
  const whole = absolute / base;
  const fractional = (absolute % base).toString().padStart(scale, '0').replace(/0+$/, '');
  const grouped = new Intl.NumberFormat('en-KE', { maximumFractionDigits: 0 }).format(whole);
  return `${negative ? '−' : ''}${grouped}${fractional ? `.${fractional}` : ''} ${asset}`;
}
