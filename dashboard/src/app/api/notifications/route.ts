import { NextResponse } from 'next/server';
import { getCurrentSchool, requireStaff } from '@/lib/auth';
import { createClient } from '@/lib/supabase/server';

export async function GET() {
  await requireStaff();
  const school = await getCurrentSchool();
  if (!school) return NextResponse.json({ total: 0, items: [] });
  const db = await createClient();
  const { data, error } = await db.rpc('staff_notifications', { p_school_id: school.id });
  if (error) return NextResponse.json({ error: 'Notifications are temporarily unavailable.' }, { status: 503 });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'private, no-store' } });
}

export async function POST(request: Request) {
  await requireStaff();
  const body = await request.json().catch(() => null);
  if (!body || !['support', 'reply'].includes(body.kind) || !Array.isArray(body.ids) || body.ids.length > 200 ||
      body.ids.some((id: unknown) => typeof id !== 'string' || !/^[a-f0-9-]{36}$/i.test(id))) {
    return NextResponse.json({ error: 'Invalid read request.' }, { status: 400 });
  }
  const db = await createClient();
  const { error } = await db.rpc('communication_mark_read', { p_kind: body.kind, p_ids: body.ids });
  return NextResponse.json(error ? { error: 'Could not save read status.' } : { ok: true }, { status: error ? 400 : 200 });
}
