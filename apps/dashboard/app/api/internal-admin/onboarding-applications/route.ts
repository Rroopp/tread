import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function GET() {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const response = await fetch(`${apiUrl}/v1/internal/admin/onboarding-applications?limit=100`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
