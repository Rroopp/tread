import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

async function accessToken() { return (await cookies()).get('tread_access')?.value; }

export async function GET() {
  const token = await accessToken();
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const response = await fetch(`${apiUrl}/v1/institutions/current/customers`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}

export async function POST(request: Request) {
  const token = await accessToken();
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const response = await fetch(`${apiUrl}/v1/institutions/current/customers`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(await request.json()), cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
