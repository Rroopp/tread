import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from '../dashboard-shell';
import { SessionRecovery } from '../session-recovery';
import { formatMinor } from '../money';

export const metadata: Metadata = { title: 'Reports | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function ReportsPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [dashboardResponse, transactionsResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard/transactions?limit=100&offset=0`, { headers, cache: 'no-store' }),
  ]);
  if ((dashboardResponse.status === 401 || transactionsResponse.status === 401) && refresh) return <SessionRecovery />;
  if (!dashboardResponse.ok || !transactionsResponse.ok) redirect('/dashboard');
  const [dashboard, result] = await Promise.all([dashboardResponse.json(), transactionsResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={result.environment ?? 'SANDBOX'} active="reports" title="Reports"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">REPORTING · {result.environment ?? 'SANDBOX'}</div><h1>Reports</h1><p>Export transaction activity for reconciliation and internal analysis.</p></div></header>
    <section className="panel"><div className="panel-header"><div><h2>Transaction activity</h2><p>{Number(result.total).toLocaleString()} records in this environment.</p></div></div><form className="transaction-filters report-filter" action="/api/institution/reports/transactions"><label><span>From</span><input type="date" name="from" /></label><label><span>To</span><input type="date" name="to" /></label><button className="filter-button" type="submit">Download CSV</button></form><p className="capability-note">The export includes up to the 100 most recent transaction records and uses exact minor-unit amounts. It is an activity report, not a bank statement or settlement confirmation.</p>{Number(result.total) > 100 && <p className="form-error">There are more than 100 records. Narrow the date range or use the API to page through the full history.</p>}</section>
    <section className="panel"><h2>Account balances</h2><div className="table-wrap"><table><thead><tr><th>ACCOUNT</th><th>ASSET</th><th>POSTED</th><th>AVAILABLE</th></tr></thead><tbody>{dashboard.accounts.map((account: { id: string; accountRef: string; assetCode: string; balanceMinor: string; availableMinor: string }) => <tr key={account.id}><td>{account.accountRef}</td><td>{account.assetCode}</td><td>{formatMinor(account.balanceMinor, account.assetCode)}</td><td>{formatMinor(account.availableMinor, account.assetCode)}</td></tr>)}</tbody></table></div>{dashboard.accounts.length === 0 && <p className="section-empty">No operational account balances to report.</p>}</section>
  </div></DashboardShell>;
}
