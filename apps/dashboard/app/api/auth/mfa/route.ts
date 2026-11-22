import { NextResponse } from 'next/server';
import { setSessionCookies } from '../session-cookies';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request) {
  const body = await request.json();
  const action = body.action;
  const paths: Record<string, string> = { setup: 'setup', confirm: 'confirm', verify: 'verify' };
  if (typeof action !== 'string' || !paths[action]) return NextResponse.json({ message: 'Invalid MFA action' }, { status: 400 });
  const { action: _action, ...payload } = body;
  const upstream = await fetch(`${apiUrl}/v1/auth/mfa/${paths[action]}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store',
  });
  const result = await upstream.json();
  if (!upstream.ok) return NextResponse.json(result, { status: upstream.status });
  if (action === 'verify' && result.accessToken) return setSessionCookies(result);
  return NextResponse.json(result);
}
