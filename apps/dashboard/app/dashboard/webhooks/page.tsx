import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SessionRecovery } from '../session-recovery';
import { WebhookManager } from './webhook-manager';
import { DashboardShell } from '../dashboard-shell';

export const metadata: Metadata = { title: 'Webhooks | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export default async function WebhooksPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refreshToken = jar.get('tread_refresh')?.value;
  if (!token) { if (refreshToken) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [endpointResponse, deliveryResponse, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/webhooks/endpoints`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/webhooks/deliveries`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((endpointResponse.status === 401 || deliveryResponse.status === 401 || dashboardResponse.status === 401) && refreshToken) return <SessionRecovery />;
  if (!endpointResponse.ok || !deliveryResponse.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [{ endpoints }, { deliveries }, dashboard] = await Promise.all([endpointResponse.json(), deliveryResponse.json(), dashboardResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={dashboard.environment?.environment ?? 'SANDBOX'} active="webhooks" title="Webhooks"><div className="page-content"><div className="onboarding-content"><div className="eyebrow">DEVELOPER SETTINGS · SANDBOX</div><h1>Webhooks.</h1><p className="onboarding-intro">Configure signed event delivery and review recent attempts. Deliveries are asynchronous and retried automatically.</p><WebhookManager endpoints={endpoints} deliveries={deliveries} /></div></div></DashboardShell>;
}
