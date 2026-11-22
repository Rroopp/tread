import type { Metadata } from 'next';
import Link from 'next/link';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { SessionRecovery } from '../session-recovery';
import { DashboardShell } from '../dashboard-shell';
import { SandboxConsole } from './sandbox-console';

export const metadata: Metadata = { title: 'Developer guide | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';
const publicApiUrl = process.env.TREAD_PUBLIC_API_URL ?? 'http://localhost:3000';

export default async function DeveloperGuidePage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const response = await fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  if (response.status === 401 && refresh) return <SessionRecovery />;
  if (!response.ok) redirect('/login');
  const dashboard = await response.json();
  return <DashboardShell institution={dashboard.institution.display_name} environment={dashboard.environment?.environment ?? 'SANDBOX'} active="developers" title="Developer guide"><div className="page-content"><section className="onboarding-content developer-guide">
    <div className="eyebrow">DEVELOPER PORTAL · SANDBOX</div><h1>Build with TREAD.</h1><p className="onboarding-intro">Use institution API credentials with only the scopes your integration needs. Sandbox quotes and compliance outcomes are simulations; no payment or asset transfer occurs.</p>
    <section className="panel"><h2>API basics</h2><p>Base URL</p><code>{publicApiUrl}/v1</code><p>Authentication</p><code>Authorization: Bearer &lt;institution_api_key&gt;</code><p>Financial create requests require a unique idempotency key. Retry the same request with the same key after a timeout.</p></section>
    <section className="panel"><h2>Request a sandbox quote</h2><pre><code>{`curl -X POST ${publicApiUrl}/v1/quotes -H 'Authorization: Bearer $TREAD_API_KEY' -H 'Content-Type: application/json' -d '{"sourceAssetCode":"KES","destinationAssetCode":"USD","sourceAmountMinor":"10000"}'`}</code></pre><p>Quotes expire after 60 seconds and include an explicit SANDBOX_SIMULATED mode.</p></section>
    <SandboxConsole />
    <section className="panel"><h2>Create a transaction request</h2><pre><code>{`curl -X POST ${publicApiUrl}/v1/transactions -H 'Authorization: Bearer $TREAD_API_KEY' -H 'Idempotency-Key: transfer-12345' -H 'Content-Type: application/json' -d '{"quoteId":"<quote-id>"}'`}</code></pre><p>This stores a request. Provider execution and settlement are not enabled.</p></section>
    <section className="panel"><h2>Scopes and docs</h2><p>Grant only required transaction, account, quote, and webhook scopes. Production credentials are not enabled for provider execution.</p><Link href="/dashboard/api-keys">Manage API credentials →</Link><p><a href={`${publicApiUrl}/docs`} target="_blank" rel="noreferrer">Open generated OpenAPI docs ↗</a></p></section>
    <section className="panel"><h2>Webhook verification</h2><p>Webhook deliveries use timestamped HMAC signatures. Compare signatures with a constant-time comparison, reject stale timestamps, and deduplicate by event ID.</p></section>
  </section></div></DashboardShell>;
}
