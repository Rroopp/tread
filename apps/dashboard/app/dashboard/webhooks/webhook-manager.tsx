'use client';

import { FormEvent, useState } from 'react';

type Endpoint = { id: string; url: string; description: string; event_types: string[]; status: string; created_at: string };
type Delivery = { id: string; endpoint_id: string; event_type: string; status: string; attempts: number; last_http_status: number | null; next_attempt_at: string | null; delivered_at: string | null };
const events = ['transaction.created', 'transaction.status_changed', 'quote.created'];

export function WebhookManager({ endpoints: initial, deliveries }: { endpoints: Endpoint[]; deliveries: Delivery[] }) {
  const [endpoints, setEndpoints] = useState(initial);
  const [secret, setSecret] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setSecret('');
    const form = new FormData(event.currentTarget);
    const eventTypes = form.getAll('events').filter((value): value is string => typeof value === 'string');
    try {
      const response = await fetch('/api/institution/webhooks', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: form.get('url'), description: form.get('description'), eventTypes }) });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? 'Unable to add endpoint.');
      setSecret(payload.signingSecret);
      setEndpoints((current) => [{ id: payload.id, url: payload.url, description: payload.description, event_types: payload.eventTypes, status: 'ACTIVE', created_at: new Date().toISOString() }, ...current]);
      event.currentTarget.reset();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to add endpoint.'); }
    finally { setBusy(false); }
  }
  async function disable(id: string) {
    const response = await fetch(`/api/institution/webhooks/${id}`, { method: 'DELETE' }); const payload = await response.json();
    if (!response.ok) { setError(payload.error?.message ?? 'Unable to disable endpoint.'); return; }
    setEndpoints((current) => current.map((item) => item.id === id ? { ...item, status: 'DISABLED' } : item));
  }
  return <>
    <form className="onboarding-form" onSubmit={create}>
      <label>Endpoint URL<input name="url" type="url" required placeholder="https://api.example.com/tread/events" /></label>
      <label>Description<input name="description" required maxLength={120} placeholder="Production payment notifications" /></label>
      <fieldset><legend>Events</legend>{events.map((name) => <label key={name}><input name="events" type="checkbox" value={name} defaultChecked /> {name}</label>)}</fieldset>
      <p>HTTPS endpoints must use a hostname listed in the platform webhook allowlist.</p>
      {error && <p className="form-error" role="alert">{error}</p>}
      <button className="button-primary form-submit" disabled={busy}>{busy ? 'Registering…' : 'Register endpoint'} <span>→</span></button>
    </form>
    {secret && <section className="panel"><b>Copy signing secret now</b><p>It will not be shown again. Verify each request using the timestamped HMAC signature.</p><code>{secret}</code><button type="button" onClick={() => void navigator.clipboard.writeText(secret)}>Copy secret</button></section>}
    <section className="panel"><h2>Endpoints</h2>{endpoints.length ? endpoints.map((endpoint) => <div className="account-empty" key={endpoint.id}><div><b>{endpoint.description} · {endpoint.status}</b><p>{endpoint.url}<br />{endpoint.event_types.join(', ')}</p></div>{endpoint.status === 'ACTIVE' && <button type="button" onClick={() => void disable(endpoint.id)}>Disable</button>}</div>) : <p>No webhook endpoints configured.</p>}</section>
    <section className="panel"><h2>Recent deliveries</h2>{deliveries.length ? <div className="table-wrap"><table><thead><tr><th>EVENT</th><th>STATUS</th><th>ATTEMPTS</th><th>HTTP</th><th>DELIVERED</th></tr></thead><tbody>{deliveries.map((item) => <tr key={item.id}><td>{item.event_type}</td><td>{item.status}</td><td>{item.attempts}</td><td>{item.last_http_status ?? '—'}</td><td>{item.delivered_at ? new Date(item.delivered_at).toLocaleString() : '—'}</td></tr>)}</tbody></table></div> : <p>No delivery attempts yet.</p>}</section>
  </>;
}
