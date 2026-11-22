import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from '../dashboard-shell';
import { SessionRecovery } from '../session-recovery';

export const metadata: Metadata = { title: 'Usage and billing | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function UsagePage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [usageResponse, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/dashboard/usage`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((usageResponse.status === 401 || dashboardResponse.status === 401) && refresh) return <SessionRecovery />;
  if (!usageResponse.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [data, dashboard] = await Promise.all([usageResponse.json(), dashboardResponse.json()]);
  const usage = data.usage;
  const items = usage ? [
    ['Transaction requests', usage.transactionRequests], ['Quotes', usage.quotes],
    ['Webhook deliveries', usage.webhookDeliveries], ['Successful webhooks', usage.successfulWebhookDeliveries],
  ] : [];
  return <DashboardShell institution={dashboard.institution.display_name} environment={data.environment ?? 'SANDBOX'} active="usage" title="Usage and billing"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">ACCOUNT · {data.environment ?? 'SANDBOX'}</div><h1>Usage &amp; billing</h1><p>Current period activity for this institution environment.</p></div></header>
    <section className="panel"><div className="panel-header"><div><h2>Usage this month</h2><p>{usage ? `Period from ${new Date(usage.periodStart).toLocaleDateString()}` : 'No active environment'}</p></div></div>{usage ? <dl className="detail-grid">{items.map(([label, value]) => <div key={String(label)}><dt>{label}</dt><dd>{Number(value).toLocaleString()}</dd></div>)}</dl> : <p className="section-empty">No active environment is available.</p>}<p className="capability-note">API request metering is not yet collected, so these operational counts are not a billable usage statement.</p></section>
    <section className="panel"><div className="panel-header"><div><h2>Plan and invoices</h2><p>Institutional billing configuration</p></div><span className="environment-label">NOT CONFIGURED</span></div><p className="capability-note">No plan, pricing schedule, payment method, or invoice ledger has been configured for this institution. Contact TREAD to establish commercial terms before production use.</p></section>
  </div></DashboardShell>;
}
