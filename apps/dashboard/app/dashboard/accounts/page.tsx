import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SessionRecovery } from '../session-recovery';
import { DashboardShell } from '../dashboard-shell';
import { AccountManager } from './account-manager';

export const metadata: Metadata = { title: 'Accounts | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function AccountsPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [accountsResponse, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/accounts`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((accountsResponse.status === 401 || dashboardResponse.status === 401) && refresh) return <SessionRecovery />;
  if (!accountsResponse.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [data, dashboard] = await Promise.all([accountsResponse.json(), dashboardResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={data.environment ?? 'SANDBOX'} active="accounts" title="Accounts"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">LEDGER</div><h1>Accounts</h1><p>Balances reflect posted ledger entries and active holds. External provider balances are not treated as the source of truth.</p></div></header><AccountManager accounts={data.accounts} canCreate={['OWNER', 'ADMIN'].includes(dashboard.institution.role)} /></div></DashboardShell>;
}
