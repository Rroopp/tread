import { randomUUID } from 'node:crypto';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const body = await request.json();
  const key = request.headers.get('idempotency-key') ?? randomUUID();
  const response = await fetch(`${apiUrl}/v1/institutions/current/dashboard/transactions`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'Idempotency-Key': key },
    body: JSON.stringify(body), cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
