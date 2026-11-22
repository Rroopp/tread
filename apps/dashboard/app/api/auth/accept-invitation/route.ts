import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request) {
  const body = await request.json();
  const response = await fetch(`${apiUrl}/v1/auth/accept-invitation`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
