'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatMinor } from '../money';

interface Account {
  id: string; accountRef: string; assetCode: string; accountType: string; status: string;
  balanceMinor: string; availableMinor: string; ledgerTotals: { debitMinor: string; creditMinor: string; activeHoldMinor: string };
}

export function AccountManager({ accounts, canCreate }: { accounts: Account[]; canCreate: boolean }) {
  const [rows, setRows] = useState(accounts);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function createAccount(form: FormData) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/institution/accounts', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ accountRef: form.get('accountRef'), assetCode: form.get('assetCode'), accountType: form.get('accountType') }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? 'Account could not be created');
      const refreshed = await fetch('/api/institution/accounts', { cache: 'no-store' });
      const data = await refreshed.json();
      setRows(data.accounts ?? []);
      (document.getElementById('account-create-form') as HTMLFormElement | null)?.reset();
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Request failed'); }
    finally { setBusy(false); }
  }

  return <>
    <section className="panel">
      <div className="panel-header"><div><h2>Operational accounts</h2><p>Institution owned balances and ledger totals in the active environment.</p></div><span className="progress-count">{rows.length} accounts</span></div>
      {rows.length ? <div className="table-wrap"><table><thead><tr><th>ACCOUNT</th><th>ASSET</th><th>TYPE</th><th>POSTED BALANCE</th><th>AVAILABLE</th><th>STATUS</th></tr></thead><tbody>{rows.map((account) => <tr key={account.id}><td><Link className="transaction-reference" href={`/dashboard/accounts/${account.id}`}>{account.accountRef}</Link></td><td>{account.assetCode}</td><td>{account.accountType}</td><td>{formatMinor(account.balanceMinor, account.assetCode)}</td><td>{formatMinor(account.availableMinor, account.assetCode)}</td><td>{account.status}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>No operational accounts</b><p>Create a settlement, fee, or suspense account to organize ledger activity.</p></div>}
    </section>
    {canCreate && <section className="panel"><div className="panel-header"><div><h2>Create an account</h2><p>Account creation does not fund the account or move money.</p></div></div>
      <form id="account-create-form" action={createAccount} className="form-grid compact-form">
        <label>Account reference<input name="accountRef" required minLength={2} maxLength={120} pattern="[A-Za-z0-9][A-Za-z0-9._:-]*" placeholder="treasury-kes" /></label>
        <label>Asset code<input name="assetCode" required minLength={2} maxLength={12} pattern="[A-Z0-9]{2,12}" placeholder="KES" /></label>
        <label>Account type<select name="accountType"><option value="SETTLEMENT">Settlement</option><option value="FEE">Fee</option><option value="SUSPENSE">Suspense</option></select></label>
        <button className="button-primary" disabled={busy}>{busy ? 'Creating…' : 'Create account'} <span>→</span></button>
        {error && <p className="form-error" role="alert">{error}</p>}
      </form>
    </section>}
  </>;
}
