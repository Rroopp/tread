import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SessionRecovery } from '../session-recovery';
import { ProviderConfig } from './provider-config';
import { DashboardShell } from '../dashboard-shell';
import { OnboardingReview } from './onboarding-review';

export const metadata: Metadata = { title: 'Platform operations | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export default async function InternalAdminPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const paths = ['overview', 'institutions?limit=25', 'transactions?limit=25', 'compliance-queue?limit=25', 'providers?limit=25'];
  const responses = await Promise.all([...paths.map((path) => fetch(`${apiUrl}/v1/internal/admin/${path}`, { headers, cache: 'no-store' })), fetch(`${apiUrl}/v1/internal/admin/onboarding-applications?limit=100`, { headers, cache: 'no-store' }), fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' })]);
  if (responses.some((response) => response.status === 401) && refresh) return <SessionRecovery />;
  if (responses.some((response) => response.status === 403) || responses.some((response) => !response.ok)) redirect('/dashboard');
  const [overview, institutions, transactions, compliance, providers, onboarding, dashboard] = await Promise.all(responses.map((response) => response.json()));
  return <DashboardShell institution={dashboard.institution.display_name} environment={dashboard.environment?.environment ?? 'SANDBOX'} active="overview" title="Platform operations"><div className="page-content"><section className="onboarding-content"><div className="eyebrow">RESTRICTED OPERATIONS</div><h1>Platform operations.</h1><p className="onboarding-intro">Read-only oversight for onboarding, compliance queues, provider attempts, and reconciliation exceptions. Reads are recorded in the audit log.</p>
    <section className="metrics-grid">{Object.entries(overview.counts as Record<string, number>).map(([key, value]) => <article className="metric-card" key={key}><div className="metric-heading"><span>{key.replaceAll('_', ' ')}</span></div><div className="metric-value">{value}</div></article>)}</section>
    <section className="panel"><h2>Institutions</h2><DataTable rows={institutions.institutions} columns={['display_name', 'country_code', 'status', 'active_members']} /></section>
    <OnboardingReview initialApplications={onboarding.applications} />
    <section className="panel"><h2>Recent transactions</h2><DataTable rows={transactions.transactions} columns={['institution_name', 'id', 'environment', 'asset_code', 'amount_minor', 'destination_asset_code', 'status', 'created_at']} /></section>
    <section className="panel"><h2>Compliance review queue</h2><DataTable rows={compliance.cases} columns={['institution_name', 'environment', 'transaction_id', 'transaction_status', 'check_type', 'decision', 'reason_code']} /></section>
    <ProviderConfig integrations={providers.integrations} />
    <section className="panel"><h2>Recent provider attempts</h2><DataTable rows={providers.attempts} columns={['institution_name', 'provider_code', 'transaction_id', 'attempt_number', 'status', 'provider_reference']} /></section>
    <section className="panel"><h2>Reconciliation exceptions</h2><DataTable rows={providers.reconciliationExceptions} columns={['provider_code', 'transaction_id', 'provider_reference', 'observed_status', 'result']} /></section>
  </section></div></DashboardShell>;
}

function DataTable({ rows, columns }: { rows: Array<Record<string, unknown>>; columns: string[] }) {
  return rows.length ? <div className="table-wrap"><table><thead><tr>{columns.map((column) => <th key={column}>{column.replaceAll('_', ' ').toUpperCase()}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={String(row.id ?? row.transaction_id ?? index)}>{columns.map((column) => <td key={column}>{row[column] == null ? '—' : String(row[column])}</td>)}</tr>)}</tbody></table></div> : <p>No records.</p>;
}
