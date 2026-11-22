import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { SessionRecovery } from '../session-recovery';
import { DashboardShell } from '../dashboard-shell';
import { TeamManager } from './team-manager';

export const metadata: Metadata = { title: 'Team | TREAD' };
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export default async function TeamPage() {
  const jar = await cookies(); const token = jar.get('tread_access')?.value; const refresh = jar.get('tread_refresh')?.value;
  if (!token) { if (refresh) return <SessionRecovery />; redirect('/login'); }
  const headers = { Authorization: `Bearer ${token}` };
  const responses = await Promise.all([
    fetch(`${apiUrl}/v1/institutions/current/team`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/team/invitations`, { headers, cache: 'no-store' }),
    fetch(`${apiUrl}/v1/institutions/current/dashboard`, { headers, cache: 'no-store' }),
  ]);
  if (responses.some((response) => response.status === 401) && refresh) return <SessionRecovery />;
  if (responses.some((response) => !response.ok)) redirect('/dashboard');
  const [members, invitations, dashboard] = await Promise.all(responses.map((response) => response.json()));
  return <DashboardShell institution={dashboard.institution.display_name} environment={dashboard.environment?.environment ?? 'SANDBOX'} active="team" title="Team"><div className="page-content transaction-page"><header className="transaction-heading"><div><div className="eyebrow">WORKSPACE ACCESS</div><h1>Team</h1><p>Manage people and their institution roles.</p></div></header><TeamManager members={members.members} invitations={invitations.invitations} canInviteAdmin={dashboard.institution.role === 'OWNER'} /></div></DashboardShell>;
}
