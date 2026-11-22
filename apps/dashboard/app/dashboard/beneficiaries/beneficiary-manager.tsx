'use client';

import { FormEvent, useState } from 'react';

interface Beneficiary { id: string; external_reference: string; destination_type: string; country_code: string; currency_code: string; status: string; masked_destination: string; customer_reference: string | null; display_name: string }
interface CustomerOption { id: string; externalReference: string; displayName: string; status: string }

export function BeneficiaryManager({ beneficiaries: initial, customers, canWrite }: { beneficiaries: Beneficiary[]; customers: CustomerOption[]; canWrite: boolean }) {
  const [beneficiaries, setBeneficiaries] = useState(initial); const [destinationType, setDestinationType] = useState<'BANK' | 'MOBILE_MONEY' | 'CRYPTO_WALLET'>('BANK');
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const formElement = event.currentTarget; const form = new FormData(formElement);
    const destinationKeys = destinationType === 'BANK' ? ['accountNumber', 'iban', 'bankCode', 'branchCode'] : destinationType === 'MOBILE_MONEY' ? ['phoneNumber', 'providerCode'] : ['address', 'network'];
    const destinationDetails = Object.fromEntries(destinationKeys.map((key) => [key, form.get(key)]).filter(([, value]) => typeof value === 'string' && value !== ''));
    const body = { externalReference: form.get('externalReference'), customerId: form.get('customerId') || undefined, destinationType, countryCode: form.get('countryCode'), currencyCode: form.get('currencyCode'), displayName: form.get('displayName'), destinationDetails };
    try {
      const response = await fetch('/api/institution/beneficiaries', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Beneficiary could not be created');
      setBeneficiaries((rows) => [{ ...result, external_reference: result.externalReference, destination_type: result.destinationType, country_code: result.countryCode, currency_code: result.currencyCode, masked_destination: result.maskedDestination, customer_reference: customers.find((customer) => customer.id === body.customerId)?.externalReference ?? null, display_name: result.displayName }, ...rows]);
      formElement.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Beneficiary could not be created'); }
    finally { setBusy(false); }
  }
  async function disable(row: Beneficiary) {
    const response = await fetch(`/api/institution/beneficiaries/${row.id}`, { method: 'DELETE' }); const result = await response.json();
    if (!response.ok) { setError(result.error?.message ?? 'Beneficiary could not be disabled'); return; }
    setBeneficiaries((rows) => rows.map((item) => item.id === row.id ? { ...item, status: 'DISABLED' } : item));
  }
  return <>
    {canWrite && <section className="panel"><div className="panel-header"><div><h2>Add beneficiary</h2><p>Destination details are encrypted and only the masked value is shown afterwards.</p></div></div><form className="onboarding-form beneficiary-form" onSubmit={create}>
      <label>Reference<input name="externalReference" required minLength={2} maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9._:-]*" placeholder="supplier-876" /></label>
      <label>Beneficiary name<input name="displayName" required maxLength={160} /></label>
      <label>Linked customer<select name="customerId" defaultValue=""><option value="">No linked customer</option>{customers.filter((customer) => customer.status !== 'DISABLED').map((customer) => <option key={customer.id} value={customer.id}>{customer.externalReference} · {customer.displayName}</option>)}</select></label>
      <label>Destination type<select value={destinationType} onChange={(event) => setDestinationType(event.target.value as typeof destinationType)}><option value="BANK">Bank account</option><option value="MOBILE_MONEY">Mobile money</option><option value="CRYPTO_WALLET">Crypto wallet</option></select></label>
      <label>Country<input name="countryCode" required maxLength={2} pattern="[A-Z]{2}" placeholder="KE" /></label>
      <label>Currency or asset<input name="currencyCode" required maxLength={12} pattern="[A-Z0-9]{2,12}" placeholder="KES" /></label>
      {destinationType === 'BANK' && <><label>Bank code<input name="bankCode" required maxLength={100} /></label><label>Account number<input name="accountNumber" maxLength={200} /></label><label>IBAN<input name="iban" maxLength={200} /></label><label>Branch code<input name="branchCode" maxLength={100} /></label><p className="form-hint">Provide an account number or IBAN.</p></>}
      {destinationType === 'MOBILE_MONEY' && <><label>Phone number<input name="phoneNumber" required type="tel" pattern="\+[1-9][0-9]{6,14}" placeholder="+254700000000" /></label><label>Provider code<input name="providerCode" required maxLength={100} /></label></>}
      {destinationType === 'CRYPTO_WALLET' && <><label>Wallet address<input name="address" required maxLength={200} autoComplete="off" /></label><label>Network<input name="network" required maxLength={100} placeholder="BASE" /></label></>}
      {error && <p className="form-error" role="alert">{error}</p>}<button className="button-primary form-submit" disabled={busy}>{busy ? 'Encrypting…' : 'Save beneficiary'} <span>→</span></button>
    </form></section>}
    <section className="panel"><div className="panel-header"><div><h2>Beneficiaries</h2><p>Stored payout destinations. Saving a beneficiary does not verify or pay it.</p></div><span className="progress-count">{beneficiaries.length} records</span></div>
      {beneficiaries.length ? <div className="table-wrap"><table><thead><tr><th>BENEFICIARY</th><th>REFERENCE</th><th>TYPE</th><th>DESTINATION</th><th>CURRENCY</th><th>STATUS</th><th></th></tr></thead><tbody>{beneficiaries.map((row) => <tr key={row.id}><td>{row.display_name}<small className="subtle-cell">{row.customer_reference ? `Customer ${row.customer_reference}` : 'Institution beneficiary'}</small></td><td>{row.external_reference}</td><td>{row.destination_type.replaceAll('_', ' ')}</td><td><span className="mono-value">{row.masked_destination}</span></td><td>{row.country_code} · {row.currency_code}</td><td>{row.status.replaceAll('_', ' ')}</td><td>{canWrite && row.status !== 'DISABLED' && <button className="text-action" type="button" onClick={() => void disable(row)}>Disable</button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>No saved beneficiaries</b><p>Destination records remain pending verification and cannot be used for payouts yet.</p></div>}
    </section>
  </>;
}
