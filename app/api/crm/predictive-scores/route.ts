import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@/lib/supabase/server';

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{12}$/i;

export async function GET(request: NextRequest) {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const conversation = request.nextUrl.searchParams.get('conversation')?.trim() ?? '';
  if (!UUID.test(conversation)) return NextResponse.json({ error: 'conversation_uuid_required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });

  const { data, error } = await supabase.rpc('crm_predictive_scores', { p_conversation_id: conversation });
  if (error) return NextResponse.json({ error: 'predictive_score_failed', detail: error.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  if (!data) return NextResponse.json({ error: 'conversation_not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });

  const { data: snapshotId, error: snapshotError } = await supabase.rpc('crm_predictive_snapshot', { p_conversation_id: conversation });
  if (snapshotError) return NextResponse.json({ error: 'predictive_snapshot_failed', detail: snapshotError.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });

  return NextResponse.json({ ...data, snapshot_id: snapshotId, evaluation_status: 'pending_real_outcome' }, { headers: { 'Cache-Control': 'no-store' } });
}
