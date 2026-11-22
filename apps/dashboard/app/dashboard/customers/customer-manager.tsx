'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Customer { id: string; externalReference: string; customerType: string; countryCode: string; status: string; displayName: string; email: string | null; phone: string | null; createdAt: string }

export function CustomerManager({ customers: initial, canWrite }: { customers: Customer[]; canWrite: boolean }) {
  const router = useRouter(); const [customers, setCustomers] = useState(initial); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError('');
    const formElement = event.currentTarget; const form = new FormData(formElement);
    const body = Object.fromEntries([...form.entries()].filter(([, value]) => value !== ''));
    try {
      const response = await fetch('/api/institution/customers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Customer record could not be created');
      setCustomers((rows) => [result, ...rows]); formElement.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Customer record could not be created'); }
    finally { setBusy(false); }
  }
  async function disable(customer: Customer) {
    const response = await fetch(`/api/institution/customers/${customer.id}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) { setError(result.error?.message ?? 'Customer could not be disabled'); return; }
    setCustomers((rows) => rows.map((row) => row.id === customer.id ? { ...row, status: 'DISABLED' } : row));
  }
  return <>
    {canWrite && <section className="panel"><div className="panel-header"><div><h2>Register customer</h2><p>Personal fields are encrypted at rest. New records remain pending provider verification.</p></div></div><form className="onboarding-form customer-form" onSubmit={create}>
      <label>Customer reference<input name="externalReference" required minLength={2} maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9._:-]*" placeholder="customer-1042" /></label>
      <label>Type<select name="customerType"><option value="INDIVIDUAL">Individual</option><option value="BUSINESS">Business</option></select></label>
      <label>Country<input name="countryCode" required maxLength={2} pattern="[A-Z]{2}" placeholder="KE" /></label>
      <label>Legal or display name<input name="displayName" required maxLength={160} autoComplete="name" /></label>
      <label>Email<input name="email" type="email" maxLength={254} autoComplete="email" /></label>
      <label>Phone<input name="phone" type="tel" maxLength={40} autoComplete="tel" /></label>
      {error && <p className="form-error" role="alert">{error}</p>}<button className="button-primary form-submit" disabled={busy}>{busy ? 'Saving…' : 'Add customer'} <span>→</span></button>
    </form></section>}
    <section className="panel"><div className="panel-header"><div><h2>Customer records</h2><p>Only institution and environment scoped records appear here.</p></div><span className="progress-count">{customers.length} records</span></div>
      {customers.length ? <div className="table-wrap"><table><thead><tr><th>CUSTOMER</th><th>REFERENCE</th><th>TYPE</th><th>COUNTRY</th><th>VERIFICATION</th><th>CONTACT</th><th></th></tr></thead><tbody>{customers.map((row) => <tr key={row.id}><td>{row.displayName}</td><td>{row.externalReference}</td><td>{row.customerType}</td><td>{row.countryCode}</td><td><span className="status-badge warning"><i />{row.status.replaceAll('_', ' ')}</span></td><td>{[row.email, row.phone].filter(Boolean).join(' · ') || '—'}</td><td>{canWrite && row.status !== 'DISABLED' && <button className="text-action" type="button" onClick={() => void disable(row)}>Disable</button>}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>No customer records</b><p>Customer creation stores a pending profile only. Verification requires a configured KYC provider.</p></div>}
    </section>
  </>;
}
