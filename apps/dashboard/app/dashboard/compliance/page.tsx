import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { DashboardShell } from '../dashboard-shell';
import { SessionRecovery } from '../session-recovery';
import { formatMinor } from '../money';
import { StatusBadge, humanize } from '../transactions/transaction-ui';

export const metadata: Metadata = { title: 'Compliance | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';
type ComplianceCheck = { checkType: string; decision: string; decisionMode: string; providerCode: string; reasonCode: string | null; createdAt: string };
type DecisionRow = { transaction_id: string; transaction_status: string; asset_code: string; amount_minor: string | null; transaction_created_at: string; checks: ComplianceCheck[] };

export default async function CompliancePage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [response, dashboardResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/dashboard/compliance?limit=25&offset=0`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if ((response.status === 401 || dashboardResponse.status === 401) && refresh) return <SessionRecovery />;
  if (!response.ok || !dashboardResponse.ok) redirect('/dashboard');
  const [data, dashboard] = await Promise.all([response.json() as Promise<{ environment: string | null; decisions: DecisionRow[]; total: number }>, dashboardResponse.json()]);
  return <DashboardShell institution={dashboard.institution.display_name} environment={data.environment ?? 'SANDBOX'} active="compliance" title="Compliance"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">RISK &amp; CONTROLS · {data.environment ?? 'SANDBOX'}</div><h1>Compliance</h1><p>Review the latest recorded screening decisions associated with transaction requests.</p></div></header><div className="table-meta"><span><strong>{data.total.toLocaleString()}</strong> transactions</span><span>Latest decisions · {data.environment === 'SANDBOX' ? 'simulated' : 'live'}</span></div><div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>TRANSACTION</th><th>AMOUNT</th><th>LATEST CHECKS</th><th>MODE</th><th>CREATED</th></tr></thead><tbody>{data.decisions.map((row) => <tr key={row.transaction_id}><td><Link className="transaction-reference" href={`/dashboard/transactions/${row.transaction_id}`}>{row.transaction_id.slice(0, 12)}<small>{humanize(row.transaction_status)}</small></Link></td><td>{formatMinor(row.amount_minor, row.asset_code)}</td><td>{row.checks.length ? <div className="compliance-check-list">{row.checks.map((check) => <div key={check.checkType}><span>{humanize(check.checkType)}</span><StatusBadge status={check.decision} />{check.reasonCode && <small>{check.reasonCode}</small>}</div>)}</div> : <span className="section-empty">No checks recorded</span>}</td><td>{row.checks[0]?.decisionMode ?? '—'}</td><td className="date-cell">{new Date(row.transaction_created_at).toLocaleString()}</td></tr>)}</tbody></table>{data.decisions.length === 0 && <div className="transaction-empty"><b>No compliance decisions recorded</b><p>Provider screening is not connected; sandbox checks are created only through the sandbox simulation flow.</p></div>}</div></div></DashboardShell>;
}
