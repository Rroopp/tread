'use client';

import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';

type Member = { user_id: string; email: string; role: string; status: string; created_at: string };
type Invitation = { id: string; email: string; role: string; created_at: string; expires_at: string };

export function TeamManager({ members, invitations, canInviteAdmin }: { members: Member[]; invitations: Invitation[]; canInviteAdmin: boolean }) {
  const router = useRouter(); const [error, setError] = useState(''); const [token, setToken] = useState(''); const [busy, setBusy] = useState(false);
  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(''); setToken('');
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch('/api/institution/team/invitations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: form.get('email'), role: form.get('role') }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error?.message ?? 'Unable to send invitation.');
      setToken(result.invitationToken); event.currentTarget.reset(); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Unable to send invitation.'); }
    finally { setBusy(false); }
  }
  async function revoke(id: string) {
    const response = await fetch(`/api/institution/team/invitations/${id}`, { method: 'DELETE' }); const result = await response.json();
    if (!response.ok) { setError(result.error?.message ?? 'Unable to revoke invitation.'); return; }
    router.refresh();
  }
  const invitationPath = token ? `/accept-invitation?token=${encodeURIComponent(token)}` : '';
  return <div className="team-workspace">
    <section className="team-invite-section"><div className="section-title"><div><h2>Invite a teammate</h2><p>Invitation tokens are shown once. Share them through a trusted channel.</p></div></div>
      <form className="team-invite-form" onSubmit={invite}><label>Email address<input type="email" name="email" autoComplete="email" required maxLength={254} placeholder="teammate@institution.com" /></label><label>Role<select name="role">{canInviteAdmin && <><option value="ADMIN">Administrator</option><option value="COMPLIANCE">Compliance</option></>}<option value="OPERATOR">Operator</option><option value="VIEWER">Viewer</option></select></label><button className="filter-button" disabled={busy}>{busy ? 'Creating invite…' : 'Create invitation'}</button></form>
      {error && <p className="form-error" role="alert">{error}</p>}
      {token && <div className="invite-result"><div><strong>Invitation created</strong><p>Copy the secure link now. It expires in 7 days.</p><a href={invitationPath}>{invitationPath}</a></div><button type="button" className="filter-button" onClick={() => void navigator.clipboard.writeText(`${window.location.origin}${invitationPath}`)}>Copy link</button></div>}
    </section>
    <section className="team-list-section"><div className="section-title"><div><h2>People</h2><p>{members.length} active or invited members</p></div></div><div className="team-table-wrap"><table><thead><tr><th>MEMBER</th><th>ROLE</th><th>STATUS</th><th>ADDED</th></tr></thead><tbody>{members.map((member) => <tr key={member.user_id}><td>{member.email}</td><td>{humanize(member.role)}</td><td>{humanize(member.status)}</td><td>{new Date(member.created_at).toLocaleDateString()}</td></tr>)}</tbody></table>{members.length === 0 && <p className="section-empty">No teammates have joined this workspace.</p>}</div></section>
    <section className="team-list-section"><div className="section-title"><div><h2>Pending invitations</h2><p>Invitations that have not been accepted</p></div></div><div className="team-table-wrap"><table><thead><tr><th>EMAIL</th><th>ROLE</th><th>EXPIRES</th><th></th></tr></thead><tbody>{invitations.map((invitation) => <tr key={invitation.id}><td>{invitation.email}</td><td>{humanize(invitation.role)}</td><td>{new Date(invitation.expires_at).toLocaleDateString()}</td><td><button className="text-action" type="button" onClick={() => void revoke(invitation.id)}>Revoke</button></td></tr>)}</tbody></table>{invitations.length === 0 && <p className="section-empty">No pending invitations.</p>}</div></section>
  </div>;
}

function humanize(value: string) { return value.toLowerCase().replaceAll('_', ' ').replace(/\b\w/g, (letter) => letter.toUpperCase()); }
