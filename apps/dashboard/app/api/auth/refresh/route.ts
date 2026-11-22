import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST() {
  const cookieStore = await cookies();
  const refreshToken = cookieStore.get('tread_refresh')?.value;
  if (!refreshToken) return NextResponse.json({ error: { message: 'Refresh session is unavailable' } }, { status: 401 });
  try {
    const response = await fetch(`${apiUrl}/v1/auth/refresh`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken }), cache: 'no-store',
    });
    if (!response.ok) throw new Error('Refresh failed');
    const payload = await response.json();
    const result = NextResponse.json({ status: 'refreshed' });
    const secure = process.env.NODE_ENV === 'production';
    result.cookies.set('tread_access', payload.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: payload.expiresIn });
    const refreshExpiry = Math.max(0, Math.floor((Date.parse(payload.refreshExpiresAt) - Date.now()) / 1000));
    result.cookies.set('tread_refresh', payload.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: refreshExpiry });
    return result;
  } catch {
    const result = NextResponse.json({ error: { message: 'Refresh session expired' } }, { status: 401 });
    result.cookies.delete('tread_access');
    result.cookies.delete('tread_refresh');
    return result;
  }
}
