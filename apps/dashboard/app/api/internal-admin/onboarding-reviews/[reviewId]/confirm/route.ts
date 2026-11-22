import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? process.env.NEXT_PUBLIC_TREAD_API_URL ?? 'http://localhost:3000';

export async function POST(_request: Request, context: { params: Promise<{ reviewId: string }> }) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ message: 'Unauthenticated' }, { status: 401 });
  const { reviewId } = await context.params;
  const response = await fetch(`${apiUrl}/v1/internal/admin/onboarding-reviews/${encodeURIComponent(reviewId)}/confirm`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, cache: 'no-store',
  });
  return NextResponse.json(await response.json(), { status: response.status });
}
