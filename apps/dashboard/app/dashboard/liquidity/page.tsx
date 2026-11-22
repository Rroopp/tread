import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from '../dashboard-shell';
import { SessionRecovery } from '../session-recovery';
import { QuoteManager } from './quote-manager';

export const metadata: Metadata = { title: 'FX and liquidity | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function LiquidityPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [quotesResponse, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/dashboard/quotes`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((quotesResponse.status === 401 || dashboardResponse.status === 401) && refresh) return <SessionRecovery />;
  if (quotesResponse.status === 403) redirect('/dashboard');
  if (!quotesResponse.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [data, dashboard] = await Promise.all([quotesResponse.json(), dashboardResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={data.environment ?? 'SANDBOX'} active="liquidity" title="FX and liquidity"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">PRICING &amp; ROUTING · {data.environment ?? 'SANDBOX'}</div><h1>FX &amp; liquidity</h1><p>Request conversion quotes and review their source, expiry, and execution mode.</p></div></header><QuoteManager initial={data.quotes} /></div></DashboardShell>;
}
