import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { notFound } from 'next/navigation';
import { SessionRecovery } from '../../session-recovery';
import { DashboardShell } from '../../dashboard-shell';
import { formatMinor } from '../../money';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function AccountDetailPage({ params }: { params: Promise<{ accountId: string }> }) {
  const { accountId } = await params;
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [response, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/accounts/${encodeURIComponent(accountId)}`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((response.status === 401 || dashboardResponse.status === 401) && refresh) return <SessionRecovery />;
  if (response.status === 404) notFound();
  if (!response.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [account, dashboard] = await Promise.all([response.json(), dashboardResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={dashboard.environment?.environment ?? 'SANDBOX'} active="accounts" title={account.accountRef}><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">ACCOUNT DETAIL · {account.accountType}</div><h1>{account.accountRef}</h1><p>{account.assetCode} · {account.status} · Opened {new Date(account.createdAt).toLocaleDateString()}</p></div><Link href="/dashboard/accounts" className="button-secondary">← All accounts</Link></header><section className="metrics-grid"><article className="metric-card"><div className="metric-heading">Posted balance</div><div className="metric-value">{formatMinor(account.balanceMinor, account.assetCode)}</div></article><article className="metric-card"><div className="metric-heading">Available balance</div><div className="metric-value">{formatMinor(account.availableMinor, account.assetCode)}</div></article><article className="metric-card"><div className="metric-heading">Active holds</div><div className="metric-value">{formatMinor(account.ledgerTotals.activeHoldMinor, account.assetCode)}</div></article></section><section className="panel"><div className="panel-header"><div><h2>Ledger totals</h2><p>Accumulated debit and credit entries for this account.</p></div></div><dl className="detail-grid"><div><dt>Total debits</dt><dd>{formatMinor(account.ledgerTotals.debitMinor, account.assetCode)}</dd></div><div><dt>Total credits</dt><dd>{formatMinor(account.ledgerTotals.creditMinor, account.assetCode)}</dd></div></dl></section></div></DashboardShell>;
}
