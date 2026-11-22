import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from '../dashboard-shell';
import { SessionRecovery } from '../session-recovery';
import { BeneficiaryManager } from './beneficiary-manager';

export const metadata: Metadata = { title: 'Beneficiaries | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export default async function BeneficiariesPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [beneficiariesResponse, customersResponse, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/beneficiaries`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/customers`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ([beneficiariesResponse, customersResponse, dashboardResponse].some((response) => response.status === 401) && refresh) return <SessionRecovery />;
  if ([beneficiariesResponse, customersResponse, dashboardResponse].some((response) => response.status === 403)) redirect('/dashboard');
  if (!beneficiariesResponse.ok || !customersResponse.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [beneficiaries, customers, dashboard] = await Promise.all([beneficiariesResponse.json(), customersResponse.json(), dashboardResponse.json()]);
  const canWrite = ['OWNER', 'ADMIN', 'OPERATOR'].includes(dashboard.institution.role);
  return <DashboardShell institution={dashboard.institution.display_name} environment={beneficiaries.environment ?? 'SANDBOX'} active="beneficiaries" title="Beneficiaries"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">PAYOUT DESTINATIONS · {beneficiaries.environment ?? 'SANDBOX'}</div><h1>Beneficiaries</h1><p>Manage encrypted payout destinations before connecting a regulated payout partner.</p></div></header><p className="capability-note">Destinations are encrypted and masked in this workspace. There is no beneficiary verification or payout execution integration; new records remain pending verification.</p><BeneficiaryManager beneficiaries={beneficiaries.beneficiaries} customers={customers.customers} canWrite={canWrite} /></div></DashboardShell>;
}
