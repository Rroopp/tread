import Link from 'next/link';
import type { ReactNode } from 'react';
import { LogoutButton } from './logout-button';

type Section = 'overview' | 'transactions' | 'liquidity' | 'accounts' | 'customers' | 'beneficiaries' | 'compliance' | 'team' | 'reports' | 'usage' | 'developers' | 'api-keys' | 'webhooks';
const nav: Array<{ label: string; href: string; section: Section }> = [
  { label: 'Overview', href: '/dashboard', section: 'overview' },
  { label: 'Transactions', href: '/dashboard/transactions', section: 'transactions' },
  { label: 'FX & liquidity', href: '/dashboard/liquidity', section: 'liquidity' },
  { label: 'Accounts', href: '/dashboard/accounts', section: 'accounts' },
  { label: 'Compliance', href: '/dashboard/compliance', section: 'compliance' },
  { label: 'Webhooks', href: '/dashboard/webhooks', section: 'webhooks' },
  { label: 'API credentials', href: '/dashboard/api-keys', section: 'api-keys' },
];

export function DashboardShell({ children, institution, environment, active, title }: {
  children: ReactNode; institution: string; environment: string; active: Section; title: string;
}) {
  return <div className="app-shell dashboard-shell">
    <aside className="sidebar">
      <Link className="brand" href="/dashboard" aria-label="TREAD dashboard"><img className="brand-logo" src="/tread-logo-light.svg" alt="TREAD" /></Link>
      <div className="workspace-label">WORKSPACE</div>
      <div className="workspace-switcher"><span className="workspace-avatar">{institution.slice(0, 1).toUpperCase()}</span><span className="workspace-copy"><b>{institution}</b><small>{environment} environment</small></span></div>
      <div className="nav-label">OPERATIONS</div>
      <nav className="primary-nav" aria-label="Operations navigation">{nav.map((item) => <Link key={item.section} className={`nav-item${active === item.section ? ' active' : ''}`} href={item.href}>{item.label}</Link>)}</nav>
      <div className="nav-label nav-label-lower">INTEGRATION</div>
      <nav className="primary-nav" aria-label="Integration documentation"><a className="nav-item" href={`${process.env.TREAD_PUBLIC_API_URL ?? 'http://localhost:3000'}/docs`} target="_blank" rel="noreferrer">API reference ↗</a></nav>
    </aside>
    <main className="main-panel">
      <header className="topbar"><div className="breadcrumbs"><Link href="/dashboard">Workspace</Link><b>/</b><strong>{title}</strong></div><div className="topbar-right"><span className={`environment-label ${environment.toLowerCase()}`}>{environment}</span><LogoutButton /></div></header>
      {children}
    </main>
  </div>;
}
