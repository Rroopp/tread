import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from '../dashboard-shell';
import { SessionRecovery } from '../session-recovery';
import { CustomerManager } from './customer-manager';

export const metadata: Metadata = { title: 'Customers | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function CustomersPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [customersResponse, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/customers`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((customersResponse.status === 401 || dashboardResponse.status === 401) && refresh) return <SessionRecovery />;
  if (customersResponse.status === 403) redirect('/dashboard');
  if (!customersResponse.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [data, dashboard] = await Promise.all([customersResponse.json(), dashboardResponse.json()]);
  const canWrite = ['OWNER', 'ADMIN', 'OPERATOR'].includes(dashboard.institution.role);
  return <DashboardShell institution={dashboard.institution.display_name} environment={data.environment ?? 'SANDBOX'} active="customers" title="Customers"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">CUSTOMERS · {data.environment ?? 'SANDBOX'}</div><h1>Customers</h1><p>Manage encrypted customer profiles and monitor their verification state.</p></div></header><p className="capability-note">KYC, identity verification, and screening providers are not connected. Customer records remain pending verification and cannot be used to authorize transfers.</p><CustomerManager customers={data.customers} canWrite={canWrite} /></div></DashboardShell>;
}
