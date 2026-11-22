import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';

const apiUrl = process.env.TREAD_API_URL ?? 'http://localhost:3000';
function validDate(value: string | null): boolean {
  if (value === null) return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}
const csv = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;

export async function GET(request: Request) {
  const token = (await cookies()).get('tread_access')?.value;
  if (!token) return NextResponse.json({ error: { message: 'Sign in required' } }, { status: 401 });
  const params = new URL(request.url).searchParams;
  const from = params.get('from'); const to = params.get('to');
  if (!validDate(from) || !validDate(to) || from && to && from > to) {
    return NextResponse.json({ error: { message: 'Choose a valid date range.' } }, { status: 400 });
  }
  const response = await fetch(`${apiUrl}/v1/institutions/current/dashboard/transactions?limit=100&offset=0`, { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' });
  const result = await response.json();
  if (!response.ok) return NextResponse.json(result, { status: response.status });
  const start = from ? Date.parse(`${from}T00:00:00.000Z`) : Number.NEGATIVE_INFINITY;
  const end = to ? Date.parse(`${to}T23:59:59.999Z`) : Number.POSITIVE_INFINITY;
  const rows = (result.transactions as Array<Record<string, unknown>>).filter((row) => {
    const created = Date.parse(String(row.created_at)); return created >= start && created <= end;
  });
  const columns = ['id', 'client_reference', 'status', 'asset_code', 'amount_minor', 'destination_asset_code', 'destination_amount_minor', 'created_at'];
  const body = [columns.map(csv).join(','), ...rows.map((row) => columns.map((column) => csv(row[column])).join(','))].join('\r\n');
  return new NextResponse(body, { headers: {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="tread-transaction-activity-${from ?? 'all'}-${to ?? 'latest'}.csv"`,
    'Cache-Control': 'no-store',
    'X-Total-Available': String(result.total),
  } });
}
