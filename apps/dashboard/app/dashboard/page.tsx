import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from './dashboard-shell';
import { SessionRecovery } from './session-recovery';
import { formatMinor } from './money';

export const metadata: Metadata = { title: 'Institutional overview | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

interface DashboardData {
  institution: { display_name: string; status: string; role: string };
  environment: { id: string; environment: 'SANDBOX' | 'PRODUCTION' } | null;
  accounts: Array<{ id: string; accountRef: string; assetCode: string; availableMinor: string; balanceMinor: string }>;
  transactions: Array<{ id: string; status: string; assetCode: string; amountMinor: string | null; destinationAssetCode: string | null; createdAt: string }>;
  teamMemberCount: number; apiCredentialCount: number;
}

export default async function DashboardPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const response = await fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (response.status === 401 && refresh) return <SessionRecovery />;
  if (!response.ok) redirect('/login');
  const dashboard = await response.json() as DashboardData;
  const account = dashboard.accounts[0];
  const environment = dashboard.environment?.environment ?? 'SANDBOX';
  return <DashboardShell institution={dashboard.institution.display_name} environment={environment} active="overview" title="Overview">
    <div className="page-content overview-page">
      <section className="welcome-row"><div><div className="eyebrow">{dashboard.institution.display_name.toUpperCase()} · {dashboard.institution.status}</div><h1>Money in motion,<br />in clear view.</h1><p>Monitor account positions and transaction lifecycle from one workspace.</p></div><div className="welcome-actions"><Link className="button-primary" href="/dashboard/transactions">View transactions <span>→</span></Link></div></section>
      <section className="overview-stats" aria-label="Workspace summary"><div><span>Available balance</span><strong>{account ? formatMinor(account.availableMinor, account.assetCode) : '—'}</strong><small>{account ? account.accountRef : 'No operational accounts yet'}</small></div><div><span>Transaction requests</span><strong>{dashboard.transactions.length}</strong><small>Most recent records</small></div><div><span>Workspace access</span><strong>{dashboard.teamMemberCount} people</strong><small>{dashboard.apiCredentialCount} active API credentials</small></div></section>
      <section className="panel overview-activity"><div className="panel-header"><div><h2>Recent activity</h2><p>Requests remain visible through each tracked lifecycle state.</p></div><Link href="/dashboard/transactions">All transactions →</Link></div>
        {dashboard.transactions.length ? <div className="table-wrap"><table><thead><tr><th>REFERENCE</th><th>ROUTE</th><th>AMOUNT</th><th>STATUS</th><th>CREATED</th></tr></thead><tbody>{dashboard.transactions.map((transaction) => <tr key={transaction.id}><td><Link className="transaction-reference" href={`/dashboard/transactions/${transaction.id}`}>{transaction.id.slice(0, 8)}</Link></td><td>{transaction.assetCode}{transaction.destinationAssetCode ? ` → ${transaction.destinationAssetCode}` : ''}</td><td>{formatMinor(transaction.amountMinor, transaction.assetCode)}</td><td>{transaction.status}</td><td>{new Date(transaction.createdAt).toLocaleString()}</td></tr>)}</tbody></table></div> : <div className="empty-state"><b>No transaction activity</b><p>Use the API reference to submit sandbox transaction requests.</p><a href={`${process.env.TREAD_PUBLIC_API_URL ?? 'http://localhost:3000'}/docs`} target="_blank" rel="noreferrer">Open API docs ↗</a></div>}
      </section>
      <section className="overview-links"><Link href="/dashboard/accounts"><span>01 / ACCOUNTS</span><strong>Review ledger balances</strong><small>Posted totals and active holds →</small></Link><Link href="/dashboard/api-keys"><span>02 / INTEGRATION</span><strong>Configure API access</strong><small>Scoped sandbox credentials →</small></Link><a href={`${process.env.TREAD_PUBLIC_API_URL ?? 'http://localhost:3000'}/docs`} target="_blank" rel="noreferrer"><span>03 / REFERENCE</span><strong>Read the API documentation</strong><small>OpenAPI endpoints and schemas ↗</small></a></section>
      {dashboard.institution.status !== 'ACTIVE' && <p className="capability-note">Institution onboarding status: {dashboard.institution.status}. Production capabilities remain unavailable until approval.</p>}
    </div>
  </DashboardShell>;
}
