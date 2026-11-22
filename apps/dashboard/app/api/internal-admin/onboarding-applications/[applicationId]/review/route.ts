import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(request: Request, context: { params: Promise<{ applicationId: string }> }) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { applicationId } = await context.params;
  const response = await fetch(`${apiUrl}/v1/internal/admin/onboarding-applications/${encodeURIComponent(applicationId)}/review`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: await request.text(), cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
