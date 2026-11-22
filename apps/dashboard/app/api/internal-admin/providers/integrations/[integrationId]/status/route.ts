import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function PATCH(request: Request, { params }: { params: Promise<{ integrationId: string }> }) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const { integrationId } = await params;
  const response = await fetch(`${apiUrl}/v1/internal/admin/providers/integrations/${encodeURIComponent(integrationId)}/status`, {
    method: 'PATCH', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(await request.json()), cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
