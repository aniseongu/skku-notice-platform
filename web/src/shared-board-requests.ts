import type { SupabaseClient } from '@supabase/supabase-js';

export type BoardRequestState = { id: string; name: string; status: 'pending' | 'added' | 'review' | 'failed'; source_id?: string | null };
export type BoardRequestResult = 'ok' | 'limit' | 'error';

async function matchesSession(client: SupabaseClient, userId: string): Promise<boolean> {
  const { data, error } = await client.auth.getSession();
  return !error && data.session?.user.id === userId;
}

export async function listBoardRequests(client: SupabaseClient | null, userId: string): Promise<BoardRequestState[] | null> {
  if (!client || !await matchesSession(client, userId)) return null;
  const { data, error } = await client.from('shared_board_requests').select('id,name,status,source_id')
    .eq('user_id', userId).order('created_at', { ascending: false }).limit(5);
  if (error || !await matchesSession(client, userId)) return null;
  return data as BoardRequestState[];
}

export async function submitBoardRequest(
  client: SupabaseClient | null, userId: string, name: string, url: string,
): Promise<BoardRequestResult> {
  if (!client || !await matchesSession(client, userId)) return 'error';
  const { error } = await client.rpc('submit_shared_board', {
    expected_user: userId, request_name: name, request_url: url,
  });
  if (!await matchesSession(client, userId)) return 'error';
  if (!error) return 'ok';
  return /board_request_limit/.test(`${error.message} ${error.details ?? ''}`) ? 'limit' : 'error';
}
