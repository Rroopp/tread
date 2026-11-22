import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SessionRecovery } from '../session-recovery';
import { ApiKeyManager } from './api-key-manager';
import { DashboardShell } from '../dashboard-shell';

export const metadata: Metadata = { title: 'API credentials | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export default async function ApiKeysPage() {
  const cookieStore = await cookies();
  const token = cookieStore.get('tread_access')?.value;
  const refreshToken = cookieStore.get('tread_refresh')?.value;
  if (!token) {
    if (refreshToken) return <SessionRecovery />;
    redirect('/login');
  }
  const headers = { Authorization: `Bearer ${token}` };
  const [response, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/api-keys`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((response.status === 401 || dashboardResponse.status === 401) && refreshToken) return <SessionRecovery />;
  if (!response.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [data, dashboard] = await Promise.all([response.json(), dashboardResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={dashboard.environment?.environment ?? 'SANDBOX'} active="api-keys" title="API credentials"><div className="page-content"><div className="onboarding-content"><div className="eyebrow">DEVELOPER SETTINGS</div><h1>API credentials.</h1><p className="onboarding-intro">Create least-privilege credentials. Plaintext tokens are shown once.</p><ApiKeyManager credentials={data.credentials} /></div></div></DashboardShell>;
}
