import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SessionRecovery } from '../session-recovery';
import { DashboardShell } from '../dashboard-shell';
import { formatMinor } from '../money';
import { StatusBadge, humanize } from './transaction-ui';

export const metadata: Metadata = { title: 'Transactions | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';
const statuses = ['CREATED','QUOTED','AWAITING_FUNDING','FUNDED','COMPLIANCE_PENDING','APPROVED','EXECUTING','BROADCAST','CONFIRMING','SETTLED','RECONCILED','FAILED','CANCELLED','REQUIRES_REVIEW'];
type Query = { q?: string; status?: string; page?: string };
type Row = { id: string; client_reference: string | null; status: string; asset_code: string; amount_minor: string | null; destination_asset_code: string | null; destination_amount_minor: string | null; created_at: string; updated_at: string };

export default async function TransactionsPage({ searchParams }: { searchParams: Promise<Query> }) {
  const query = await searchParams;
  const q = query.q?.slice(0, 120) ?? '';
  const status = statuses.includes(query.status ?? '') ? query.status! : '';
  const page = Math.max(0, Math.min(4000, Number.parseInt(query.page ?? '0', 10) || 0));
  const limit = 25;
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const params = new URLSearchParams({ limit: String(limit), offset: String(page * limit) });
  if (q) params.set('q', q); if (status) params.set('status', status);
  const headers = { Authorization: `Bearer ${token}` };
  const [dashboardResponse, listResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard/transactions?${params}`, { headers, cache: 'no-store' }),
  ]);
  if ((dashboardResponse.status === 401 || listResponse.status === 401) && refresh) return <SessionRecovery />;
  if (!dashboardResponse.ok || !listResponse.ok) redirect('/login');
  const dashboard = await dashboardResponse.json();
  const result = await listResponse.json() as { environment: string | null; transactions: Row[]; total: number; limit: number; offset: number };
  const pages = Math.max(1, Math.ceil(result.total / limit));
  const pageHref = (target: number) => {
    const search = new URLSearchParams(); if (q) search.set('q', q); if (status) search.set('status', status); if (target) search.set('page', String(target));
    return `/dashboard/transactions${search.size ? `?${search}` : ''}`;
  };
  return <DashboardShell institution={dashboard.institution.display_name} environment={result.environment ?? 'SANDBOX'} active="transactions" title="Transactions">
    <div className="page-content transaction-page">
      <header className="transaction-heading"><div><div className="eyebrow">OPERATIONS / {result.environment ?? 'SANDBOX'}</div><h1>Transactions</h1><p>Search requests and inspect each transaction’s lifecycle and evidence.</p></div><div className={`environment-label ${(result.environment ?? 'sandbox').toLowerCase()}`}>{result.environment ?? 'SANDBOX'} · {result.environment === 'SANDBOX' ? 'SIMULATED' : 'LIVE'}</div></header>
      <form className="transaction-filters" action="/dashboard/transactions">
        <label className="search-field"><span>Search</span><input type="search" name="q" defaultValue={q} placeholder="Transaction ID or client reference" /></label>
        <label className="status-field"><span>Status</span><select name="status" defaultValue={status}><option value="">All statuses</option>{statuses.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}</select></label>
        <button className="filter-button" type="submit">Apply filters</button>
        {(q || status) && <Link className="clear-filters" href="/dashboard/transactions">Clear</Link>}
      </form>
      <div className="table-meta"><span><strong>{result.total.toLocaleString()}</strong> transaction{result.total === 1 ? '' : 's'}</span><span>Amounts shown in asset units</span></div>
      <div className="transaction-table-wrap"><table className="transaction-table"><thead><tr><th>REFERENCE</th><th>ROUTE</th><th>SOURCE AMOUNT</th><th>STATUS</th><th>CREATED</th><th></th></tr></thead><tbody>
        {result.transactions.map((row) => <tr key={row.id}><td><Link className="transaction-reference" href={`/dashboard/transactions/${row.id}`}>{row.client_reference || row.id.slice(0, 12)}<small>{row.id}</small></Link></td><td className="route-cell">{row.asset_code}<span>→</span>{row.destination_asset_code ?? '—'}</td><td className="amount-cell">{formatMinor(row.amount_minor, row.asset_code)}{row.destination_amount_minor && row.destination_asset_code && <small>Receive {formatMinor(row.destination_amount_minor, row.destination_asset_code)}</small>}</td><td><StatusBadge status={row.status} /></td><td className="date-cell">{new Date(row.created_at).toLocaleString()}</td><td><Link className="row-open" href={`/dashboard/transactions/${row.id}`} aria-label={`Open transaction ${row.id}`}>↗</Link></td></tr>)}
      </tbody></table>
      {result.transactions.length === 0 && <div className="transaction-empty"><b>{q || status ? 'No matching transactions' : 'No transactions yet'}</b><p>{q || status ? 'Try a different reference or status.' : 'Requests created with your institution API key will appear here.'}</p></div>}
      </div>
      {pages > 1 && <nav className="pagination" aria-label="Transaction pages"><span>Page {page + 1} of {pages}</span><div>{page > 0 && <Link href={pageHref(page - 1)}>← Previous</Link>}{page + 1 < pages && <Link href={pageHref(page + 1)}>Next →</Link>}</div></nav>}
    </div>
  </DashboardShell>;
}

