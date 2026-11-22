'use client';

import { FormEvent, useState } from 'react';
import { formatMinor } from '../money';

interface Quote { id: string; source_asset_code: string; destination_asset_code: string; source_amount_minor: string; destination_amount_minor: string; rate_numerator: string; rate_denominator: string; fee_amount_minor: string; provider_code: string; quote_mode: string; status: string; expires_at: string; created_at: string }
interface NewQuote { quoteId: string; sourceAssetCode: string; destinationAssetCode: string; sourceAmountMinor: string; destinationAmountMinor: string; feeAmountMinor: string; quoteMode: string; expiresAt: string }

export function QuoteManager({ initial }: { initial: Quote[] }) {
  const [quotes, setQuotes] = useState(initial); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [currentQuote, setCurrentQuote] = useState<NewQuote | null>(null); const [transaction, setTransaction] = useState<{ id: string; status: string } | null>(null);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(''); setBusy(true);
    const formElement = event.currentTarget; const form = new FormData(formElement);
    try {
      setCurrentQuote(null); setTransaction(null);
      const response = await fetch('/api/institution/quotes', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sourceAssetCode: form.get('sourceAssetCode'), destinationAssetCode: form.get('destinationAssetCode'), sourceAmountMinor: form.get('sourceAmountMinor') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Quote unavailable');
      setCurrentQuote(result); const list = await fetch('/api/institution/quotes', { cache: 'no-store' }); const data = await list.json(); setQuotes(data.quotes ?? []); formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Quote unavailable'); }
    finally { setBusy(false); }
  }
  async function createTransaction() {
    if (!currentQuote) return;
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/institution/transactions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': crypto.randomUUID() }, body: JSON.stringify({ quoteId: currentQuote.quoteId }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Transaction request failed');
      setTransaction(result);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Transaction request failed'); }
    finally { setBusy(false); }
  }
  return <>
    <section className="panel"><div className="panel-header"><div><h2>Request a quote</h2><p>Quotes are indicative only until explicitly executed through a verified provider route.</p></div></div><form className="compact-form liquidity-form" onSubmit={create}>
      <label>From asset<input name="sourceAssetCode" required defaultValue="KES" maxLength={12} pattern="[A-Z0-9]{2,12}" /></label>
      <label>To asset<input name="destinationAssetCode" required defaultValue="USD" maxLength={12} pattern="[A-Z0-9]{2,12}" /></label>
      <label>Amount in source minor units<input name="sourceAmountMinor" required defaultValue="10000" pattern="[1-9][0-9]{0,37}" /></label>
      <button className="button-primary" disabled={busy}>{busy ? 'Pricing…' : 'Get quote'} <span>→</span></button>
      {error && <p className="form-error" role="alert">{error}</p>}
    </form><p className="capability-note">In SANDBOX, rates must be explicitly configured. In PRODUCTION, requests fail closed until a live liquidity provider and permitted corridor are configured.</p>
      {currentQuote && <div className="sandbox-result"><div><span>QUOTE · {currentQuote.quoteMode}</span><strong>{formatMinor(currentQuote.sourceAmountMinor, currentQuote.sourceAssetCode)} → {formatMinor(currentQuote.destinationAmountMinor, currentQuote.destinationAssetCode)}</strong><small>Fee {formatMinor(currentQuote.feeAmountMinor, currentQuote.sourceAssetCode)} · expires {new Date(currentQuote.expiresAt).toLocaleTimeString()}</small></div><div><p>Creating a request consumes this quote once. No funds will be moved.</p><button type="button" className="button-secondary" disabled={busy || Boolean(transaction)} onClick={() => void createTransaction()}>{busy ? 'Creating…' : transaction ? 'Request recorded' : 'Create transaction request'}</button>{transaction && <small>Request {transaction.id} · {transaction.status}</small>}</div></div>}
      {error && <p className="form-error" role="alert">{error}</p>}
    </section>
    <section className="panel"><div className="panel-header"><div><h2>Recent quotes</h2><p>Quotes expire and can be consumed only once.</p></div><span className="progress-count">{quotes.length} records</span></div>
      {quotes.length ? <div className="table-wrap"><table><thead><tr><th>QUOTE</th><th>CONVERSION</th><th>RATE</th><th>MODE</th><th>STATUS</th><th>EXPIRES</th></tr></thead><tbody>{quotes.map((quote) => <tr key={quote.id}><td><span className="mono-value">{quote.id.slice(0, 12)}</span><small className="subtle-cell">{quote.provider_code}</small></td><td>{formatMinor(quote.source_amount_minor, quote.source_asset_code)} → {formatMinor(quote.destination_amount_minor, quote.destination_asset_code)}</td><td>{quote.rate_numerator}/{quote.rate_denominator}</td><td>{quote.quote_mode}</td><td>{quote.status}</td><td>{new Date(quote.expires_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>No quotes yet</b><p>Configure a sandbox rate or connect an eligible liquidity provider.</p></div>}
    </section>
  </>;
}
