'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

const capabilities = ['BANK_RAIL', 'FX_LIQUIDITY', 'CUSTODY', 'BLOCKCHAIN', 'KYC_KYB', 'AML_SANCTIONS', 'TRAVEL_RULE'];
type Integration = { id: string; provider_code: string; display_name: string; capability: string; environment: string; status: string; secret_reference: string | null };

export function ProviderConfig({ integrations }: { integrations: Integration[] }) {
  const router = useRouter(); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); const form = new FormData(event.currentTarget);
    const payload = Object.fromEntries([...form.entries()].filter(([key, value]) => key !== 'secretReference' || value !== ''));
    try {
      const response = await fetch('/api/internal-admin/providers/integrations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Could not register provider.');
      event.currentTarget.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Could not register provider.'); }
    finally { setBusy(false); }
  }
  async function setStatus(integration: Integration) {
    const status = integration.status === 'DISABLED' ? 'CONFIGURED' : 'DISABLED';
    const response = await fetch(`/api/internal-admin/providers/integrations/${integration.id}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) });
    const result = await response.json(); if (!response.ok) { setError(result.error?.message ?? 'Could not update provider.'); return; }
    router.refresh();
  }
  return <>
    <section className="panel"><h2>Register provider configuration</h2><p>Credentials belong in managed secret storage. Enter a reference only. A CONFIGURED record does not enable execution or establish provider readiness.</p>
      <form className="onboarding-form" onSubmit={create}>
        <label>Provider code<input name="providerCode" required pattern="[a-z][a-z0-9_]{1,63}" placeholder="example_fx_sandbox" /></label>
        <label>Display name<input name="displayName" required maxLength={120} /></label>
        <label>Capability<select name="capability">{capabilities.map((capability) => <option key={capability}>{capability}</option>)}</select></label>
        <label>Environment<select name="environment"><option>SANDBOX</option><option>PRODUCTION</option></select></label>
        <label>Adapter key<input name="adapterKey" required pattern="[a-z][a-z0-9_]{1,63}" /></label>
        <label>Secret reference<input name="secretReference" placeholder="vault:secret/data/provider" /></label>
        {error && <p className="form-error" role="alert">{error}</p>}
        <button className="button-primary form-submit" disabled={busy}>{busy ? 'Saving…' : 'Register configuration'} <span>→</span></button>
      </form>
    </section>
    <section className="panel"><h2>Provider configurations</h2>{integrations.length ? integrations.map((integration) => <div className="account-empty" key={integration.id}><div><b>{integration.display_name} · {integration.status}</b><p>{integration.provider_code} · {integration.capability} · {integration.environment}<br />Secret reference: {integration.secret_reference ?? 'not set'}</p></div>{integration.status !== 'LIVE_READY' && <button type="button" onClick={() => void setStatus(integration)}>{integration.status === 'DISABLED' ? 'Mark configured' : 'Disable'}</button>}</div>) : <p>No provider configurations registered.</p>}</section>
  </>;
}
