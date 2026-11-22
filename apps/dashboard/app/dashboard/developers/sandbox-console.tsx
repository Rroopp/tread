'use client';

import { useState } from 'react';
import { formatMinor } from '../money';

interface Quote { quoteId: string; sourceAssetCode: string; destinationAssetCode: string; sourceAmountMinor: string; destinationAmountMinor: string; rateNumerator: string; rateDenominator: string; feeAmountMinor: string; quoteMode: string; expiresAt: string }

export function SandboxConsole() {
  const [quote, setQuote] = useState<Quote | null>(null);
  const [transactionId, setTransactionId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function requestQuote(form: FormData) {
    setBusy(true); setError(''); setQuote(null); setTransactionId('');
    try {
      const response = await fetch('/api/developer/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: form.get('apiKey'), sourceAssetCode: form.get('sourceAssetCode'), destinationAssetCode: form.get('destinationAssetCode'), sourceAmountMinor: form.get('sourceAmountMinor') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Quote request failed');
      setQuote(result);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Quote request failed'); }
    finally { setBusy(false); }
  }
  async function createRequest(form: FormData) {
    if (!quote) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/developer/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ apiKey: form.get('apiKey'), quoteId: quote.quoteId, idempotencyKey: crypto.randomUUID() }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Transaction request failed');
      setTransactionId(result.id);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Transaction request failed'); }
    finally { setBusy(false); }
  }
  return <section className="panel sandbox-console"><div className="panel-header"><div><h2>Try a sandbox quote</h2><p>Your API key is forwarded for this request and is not stored by the dashboard.</p></div><span className="environment-label sandbox">SANDBOX</span></div>
    <form action={requestQuote} className="compact-form sandbox-console-form">
      <label>Sandbox API key<input name="apiKey" required type="password" autoComplete="off" placeholder="trd_sandbox_…" /></label>
      <label>From<input name="sourceAssetCode" required defaultValue="KES" pattern="[A-Z0-9]{2,12}" /></label>
      <label>To<input name="destinationAssetCode" required defaultValue="USDC" pattern="[A-Z0-9]{2,12}" /></label>
      <label>Source amount in minor units<input name="sourceAmountMinor" required defaultValue="10000" pattern="[1-9][0-9]{0,37}" /></label>
      <button className="button-primary" disabled={busy}>{busy ? 'Requesting…' : 'Get quote'} <span>→</span></button>
    </form>
    {quote && <div className="sandbox-result"><div><span>QUOTE · {quote.quoteMode}</span><strong>{formatMinor(quote.sourceAmountMinor, quote.sourceAssetCode)} → {formatMinor(quote.destinationAmountMinor, quote.destinationAssetCode)}</strong><small>Rate {quote.rateNumerator}/{quote.rateDenominator} · Fee {formatMinor(quote.feeAmountMinor, quote.sourceAssetCode)} · Expires {new Date(quote.expiresAt).toLocaleTimeString()}</small></div><form action={createRequest}><p>Submit your key again to create a sandbox request. No funds move.</p><label>Sandbox API key<input name="apiKey" required type="password" autoComplete="off" placeholder="trd_sandbox_…" /></label><button className="button-secondary" disabled={busy}>Create transaction request</button></form></div>}
    {transactionId && <p className="success-note">Request recorded: <code>{transactionId}</code>. No external funds were moved.</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
  </section>;
}
