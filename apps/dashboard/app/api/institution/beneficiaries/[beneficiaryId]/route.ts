import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';

export async function DELETE(_request: Request, { params }: { params: Promise<{ beneficiaryId: string }> }) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const { beneficiaryId } = await params;
  const response = await fetch(`${apiUrl}/v1/institutions/current/beneficiaries/${encodeURIComponent(beneficiaryId)}`, { method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  return NextResponse.json(await response.json(), { status: response.status });
}
