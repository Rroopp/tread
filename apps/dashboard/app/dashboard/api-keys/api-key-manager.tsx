'use client';

import { FormEvent, useState } from 'react';

type Credential = { id: string; name: string; environment: string; key_prefix: string; scopes: string[]; revoked_at: string | null; expires_at: string | null; created_at: string };
const availableScopes = ['transactions:read', 'transactions:write', 'accounts:read', 'accounts:write', 'customers:read', 'customers:write', 'beneficiaries:read', 'beneficiaries:write', 'quotes:read', 'quotes:write', 'webhooks:read', 'webhooks:write'];

export function ApiKeyManager({ credentials: initial }: { credentials: Credential[] }) {
  const [credentials, setCredentials] = useState(initial);
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setToken('');
    const form = new FormData(event.currentTarget);
    const payload = { name: form.get('name'), environment: form.get('environment'), scopes: form.getAll('scopes').filter((scope): scope is string => typeof scope === 'string') };
    try {
      const response = await fetch('/api/institution/api-keys', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error?.message ?? 'Unable to create credential.');
      setToken(result.token);
      setCredentials((current) => [{ ...result, scopes: payload.scopes, environment: payload.environment, revoked_at: null, created_at: new Date().toISOString() }, ...current]);
      event.currentTarget.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to create credential.'); }
    finally { setBusy(false); }
  }
  async function revoke(credentialId: string) {
    const response = await fetch(`/api/institution/api-keys/${credentialId}`, { method: 'DELETE' });
    const result = await response.json();
    if (!response.ok) { setError(result.error?.message ?? 'Unable to revoke credential.'); return; }
    setCredentials((current) => current.map((credential) => credential.id === credentialId ? { ...credential, revoked_at: new Date().toISOString() } : credential));
  }
  return <>
    <form className="onboarding-form" onSubmit={create}>
      <label>Credential name<input name="name" required maxLength={120} placeholder="Payments sandbox integration" /></label>
      <label>Environment<select name="environment" defaultValue="SANDBOX"><option value="SANDBOX">Sandbox</option><option value="PRODUCTION">Production</option></select></label>
      <fieldset><legend>Permissions</legend>{availableScopes.map((scope) => <label key={scope}><input type="checkbox" name="scopes" value={scope} defaultChecked={scope === 'transactions:read'} /> {scope}</label>)}</fieldset>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary form-submit" disabled={busy}>{busy ? 'Creating…' : 'Create API key'} <span>→</span></button>
    </form>
    {token && <section className="panel"><b>Copy this key now</b><p>The secret will not be shown again.</p><code>{token}</code><button type="button" onClick={() => void navigator.clipboard.writeText(token)}>Copy key</button></section>}
    <section className="panel"><h2>Credentials</h2>{credentials.map((credential) => <div className="account-empty" key={credential.id}><div><b>{credential.name} · {credential.environment}</b><p>{credential.key_prefix} · {credential.scopes.join(', ')}</p></div>{credential.revoked_at ? <span>Revoked</span> : <button type="button" onClick={() => void revoke(credential.id)}>Revoke</button>}</div>)}</section>
  </>;
}
