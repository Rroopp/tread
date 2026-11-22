import type { Metadata } from 'next';
import { InvitationForm } from './invitation-form';

export const metadata: Metadata = { title: 'Accept invitation | TREAD' };

export default async function AcceptInvitationPage({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const params = await searchParams;
  return <main className="onboarding-page"><header className="onboarding-header"><a href="/">TREAD</a><a href="/">← Home</a></header><section className="onboarding-content"><div className="eyebrow">INSTITUTIONAL ACCESS</div><h1>Accept your invitation.</h1><p className="onboarding-intro">Set a password to activate your institution membership.</p><InvitationForm initialToken={params.token ?? ''} /></section></main>;
}
