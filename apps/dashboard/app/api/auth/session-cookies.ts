import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

interface SessionPayload {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  refreshExpiresAt: string;
}

export async function setSessionCookies(payload: SessionPayload) {
  const cookieStore = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  cookieStore.set('tread_access', payload.accessToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: payload.expiresIn });
  const refreshExpiry = Math.max(0, Math.floor((Date.parse(payload.refreshExpiresAt) - Date.now()) / 1000));
  cookieStore.set('tread_refresh', payload.refreshToken, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: refreshExpiry });
  return NextResponse.json({ status: 'authenticated' });
}
