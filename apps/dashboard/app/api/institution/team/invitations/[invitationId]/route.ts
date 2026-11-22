import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function DELETE(_request: Request, { params }: { params: Promise<{ invitationId: string }> }) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const { invitationId } = await params;
  const response = await fetch(`${apiUrl}/v1/institutions/current/team/invitations/${encodeURIComponent(invitationId)}`, {
    method: 'DELETE', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
