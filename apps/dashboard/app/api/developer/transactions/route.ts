import { NextResponse } from 'next/server';
import { randomUUID } from 'node:crypto';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request) {
  const { apiKey, quoteId, idempotencyKey } = await request.json();
  if (typeof apiKey !== 'string' || apiKey.length < 16 || typeof quoteId !== 'string') {
    return NextResponse.json({ error: { message: 'A sandbox API key and quote are required.' } }, { status: 400 });
  }
  const response = await fetch(`${apiUrl}/v1/transactions`, { method: 'POST', headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', 'Idempotency-Key': typeof idempotencyKey === 'string' ? idempotencyKey : randomUUID() }, body: JSON.stringify({ quoteId }), cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
