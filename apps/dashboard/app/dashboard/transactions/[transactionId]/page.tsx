import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SessionRecovery } from '../../session-recovery';
import { DashboardShell } from '../../dashboard-shell';
import { formatMinor } from '../../money';
import { StatusBadge, humanize } from '../transaction-ui';

export const metadata: Metadata = { title: 'Transaction details | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';
type Detail = {
  environment: string;
  transaction: { id: string; client_reference: string | null; status: string; asset_code: string; amount_minor: string | null; destination_asset_code: string | null; destination_amount_minor: string | null; quote_id: string | null; created_at: string; updated_at: string; quote_provider: string | null; quote_mode: string | null; rate_numerator: string | null; rate_denominator: string | null; fee_amount_minor: string | null; quote_expires_at: string | null };
  history: Array<{ from_status: string | null; to_status: string; reason_code: string | null; created_at: string }>;
  complianceDecisions: Array<{ check_type: string; provider_code: string; decision: string; decision_mode: string; reason_code: string | null; created_at: string }>;
  providerAttempts: Array<{ provider_code: string; attempt_number: number; status: string; provider_reference: string | null; settlement_asset_code: string | null; settlement_amount_minor: string | null; created_at: string; updated_at: string; completed_at: string | null }>;
  journals: Array<{ id: string; reference_type: string; reference_id: string; status: string; posted_at: string | null; entries: Array<{ accountRef: string; direction: string; amountMinor: string; assetCode: string }> }>;
  reconciliation: Array<{ provider_code: string; provider_reference: string; observed_status: string; observed_asset_code: string; observed_amount_minor: string; result: string; observed_at: string }>;
};

export default async function TransactionDetailPage({ params }: { params: Promise<{ transactionId: string }> }) {
  const { transactionId } = await params;
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const [dashboardResponse, detailResponse] = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard/transactions/${encodeURIComponent(transactionId)}`, { headers, cache: 'no-store' }),
  ]);
  if ((dashboardResponse.status === 401 || detailResponse.status === 401) && refresh) return <SessionRecovery />;
  if (detailResponse.status === 404) redirect('/dashboard/transactions');
  if (!dashboardResponse.ok || !detailResponse.ok) redirect('/dashboard');
  const dashboard = await dashboardResponse.json(); const detail = await detailResponse.json() as Detail; const transaction = detail.transaction;
  return <DashboardShell institution={dashboard.institution.display_name} environment={detail.environment} active="transactions" title="Transaction details">
    <div className="page-content transaction-detail-page">
      <Link className="back-link" href="/dashboard/transactions">← All transactions</Link>
      <header className="detail-heading"><div><div className="eyebrow">{detail.environment} TRANSACTION</div><h1>{transaction.client_reference || `Transaction ${transaction.id.slice(0, 8)}`}</h1><p className="detail-id">{transaction.id}</p></div><StatusBadge status={transaction.status} /></header>
      {detail.environment === 'SANDBOX' && <p className="sandbox-notice">Sandbox record · quotes and compliance outcomes may be simulated. No external funds were moved by this platform.</p>}
      <section className="detail-summary" aria-label="Transaction summary"><div><span>Source amount</span><strong>{formatMinor(transaction.amount_minor, transaction.asset_code)}</strong></div><div><span>Destination amount</span><strong>{transaction.destination_asset_code ? formatMinor(transaction.destination_amount_minor, transaction.destination_asset_code) : 'Not quoted'}</strong></div><div><span>Created</span><strong>{new Date(transaction.created_at).toLocaleString()}</strong></div><div><span>Last updated</span><strong>{new Date(transaction.updated_at).toLocaleString()}</strong></div></section>
      <section className="detail-section"><div className="section-title"><div><h2>Lifecycle</h2><p>Recorded transaction state changes</p></div><span>{detail.history.length} events</span></div>
        {detail.history.length ? <ol className="transaction-timeline">{detail.history.map((event, index) => <li key={`${event.to_status}-${event.created_at}-${index}`}><span className="timeline-mark" /><div><strong>{humanize(event.to_status)}</strong>{event.reason_code && <small>{humanize(event.reason_code)}</small>}<time>{new Date(event.created_at).toLocaleString()}</time></div></li>)}</ol> : <p className="section-empty">No lifecycle events recorded.</p>}
      </section>
      <section className="detail-section"><div className="section-title"><div><h2>Quote</h2><p>Rate and fee applied to this request</p></div></div>
        {transaction.quote_id ? <dl className="detail-grid"><div><dt>Quote ID</dt><dd>{transaction.quote_id}</dd></div><div><dt>Mode</dt><dd>{transaction.quote_mode ?? '—'}</dd></div><div><dt>Provider</dt><dd>{transaction.quote_provider ?? '—'}</dd></div><div><dt>Rate ratio</dt><dd>{transaction.rate_numerator && transaction.rate_denominator ? `${transaction.rate_numerator} / ${transaction.rate_denominator}` : '—'}</dd></div><div><dt>Fee</dt><dd>{formatMinor(transaction.fee_amount_minor, transaction.asset_code)}</dd></div><div><dt>Expires</dt><dd>{transaction.quote_expires_at ? new Date(transaction.quote_expires_at).toLocaleString() : '—'}</dd></div></dl> : <p className="section-empty">This transaction was not created from a quote.</p>}
      </section>
      <section className="detail-section"><div className="section-title"><div><h2>Compliance decisions</h2><p>Most recent checks appear first</p></div></div>
        {detail.complianceDecisions.length ? <div className="evidence-table"><table><thead><tr><th>CHECK</th><th>DECISION</th><th>MODE</th><th>PROVIDER</th><th>REASON</th><th>TIME</th></tr></thead><tbody>{detail.complianceDecisions.map((item, index) => <tr key={`${item.check_type}-${item.created_at}-${index}`}><td>{humanize(item.check_type)}</td><td><StatusBadge status={item.decision} /></td><td>{humanize(item.decision_mode)}</td><td>{item.provider_code}</td><td>{item.reason_code ?? '—'}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="section-empty">No compliance decisions recorded.</p>}
      </section>
      <section className="detail-section"><div className="section-title"><div><h2>Provider attempts</h2><p>Execution records for connected providers</p></div></div>
        {detail.providerAttempts.length ? <div className="evidence-table"><table><thead><tr><th>PROVIDER</th><th>ATTEMPT</th><th>STATUS</th><th>REFERENCE</th><th>SETTLEMENT</th><th>CREATED</th></tr></thead><tbody>{detail.providerAttempts.map((item) => <tr key={`${item.provider_code}-${item.attempt_number}`}><td>{item.provider_code}</td><td>{item.attempt_number}</td><td><StatusBadge status={item.status} /></td><td>{item.provider_reference ?? '—'}</td><td>{item.settlement_asset_code ? formatMinor(item.settlement_amount_minor, item.settlement_asset_code) : '—'}</td><td>{new Date(item.created_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="section-empty">No provider attempts. This platform currently records requests without executing transfers.</p>}
      </section>
      <section className="detail-section"><div className="section-title"><div><h2>Ledger and reconciliation</h2><p>Posted accounting entries and settlement evidence</p></div></div>
        {detail.journals.map((journal) => <div className="journal-block" key={journal.id}><div className="journal-heading"><strong>{journal.reference_type} · {journal.status}</strong><code>{journal.id}</code></div>{journal.entries.map((entry, index) => <div className="journal-entry" key={`${entry.accountRef}-${index}`}><span>{entry.accountRef}</span><span>{entry.direction}</span><strong>{formatMinor(entry.amountMinor, entry.assetCode)}</strong></div>)}</div>)}
        {detail.reconciliation.length ? <div className="evidence-table"><table><thead><tr><th>PROVIDER</th><th>REFERENCE</th><th>OBSERVED</th><th>AMOUNT</th><th>RESULT</th><th>TIME</th></tr></thead><tbody>{detail.reconciliation.map((item, index) => <tr key={`${item.provider_reference}-${index}`}><td>{item.provider_code}</td><td>{item.provider_reference}</td><td>{item.observed_status}</td><td>{formatMinor(item.observed_amount_minor, item.observed_asset_code)}</td><td>{humanize(item.result)}</td><td>{new Date(item.observed_at).toLocaleString()}</td></tr>)}</tbody></table></div> : <p className="section-empty">No reconciliation evidence received.</p>}
      </section>
    </div>
  </DashboardShell>;
}
