import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase/server';

export async function GET(request: NextRequest) {
  const supabase = await createSupabaseServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return NextResponse.json({ error: 'unauthorized' }, { status: 401, headers: { 'Cache-Control': 'no-store' } });

  const conversation = request.nextUrl.searchParams.get('conversation');
  if (!conversation || !/^[0-9a-f-]{36}$/i.test(conversation)) {
    return NextResponse.json({ error: 'conversation_uuid_required' }, { status: 400, headers: { 'Cache-Control': 'no-store' } });
  }

  const { data, error } = await supabase.rpc('crm_predictive_scores', { p_conversation_id: conversation });
  if (error) return NextResponse.json({ error: 'predictive_score_failed', detail: error.message }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  if (!data) return NextResponse.json({ error: 'conversation_not_found' }, { status: 404, headers: { 'Cache-Control': 'no-store' } });
  return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
}
