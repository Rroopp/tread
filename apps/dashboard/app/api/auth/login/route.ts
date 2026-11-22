import { NextResponse } from 'next/server';
import { setSessionCookies } from '../session-cookies';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request) {
  const body = await request.json();
  const upstream = await fetch(`${apiUrl}/v1/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  const payload = await upstream.json();
  if (!upstream.ok) return NextResponse.json(payload, { status: upstream.status });
  if (!payload.accessToken) return NextResponse.json(payload);

  return setSessionCookies(payload);
}

