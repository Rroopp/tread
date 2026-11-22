import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST() {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get('tread_access')?.value;
  if (accessToken) {
    try {
      await fetch(`${apiUrl}/v1/auth/logout`, {
        method: 'POST', headers: { Authorization: `Bearer ${accessToken}` },
        cache: 'no-store', signal: AbortSignal.timeout(2_000),
      });
    } catch {
      // Local session cookies still need to be removed when the API is unavailable.
    }
  }
  cookieStore.delete('tread_access');
  cookieStore.delete('tread_refresh');
  return NextResponse.json({ status: 'logged_out' });
}
