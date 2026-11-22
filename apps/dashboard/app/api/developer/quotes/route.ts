import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request) {
  const { apiKey, ...payload } = await request.json();
  if (typeof apiKey !== 'string' || apiKey.length < 16) return NextResponse.json({ error: { message: 'Enter a sandbox API key.' } }, { status: 400 });
  const response = await fetch(`${apiUrl}/v1/quotes`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload), cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
