import type { SupabaseClient } from '@supabase/supabase-js';

// RLS remains authoritative; the explicit owner filter also scopes each request.
export async function loadSubscriptions(client: SupabaseClient, userId: string): Promise<string[]> {
  const { data, error } = await client.from('user_source_subscriptions')
    .select('source_id').eq('user_id', userId).order('source_id');
  if (error) throw error;
  return (data ?? []).map((row) => row.source_id as string);
}

export async function setSubscription(client: SupabaseClient, userId: string, sourceId: string, enabled: boolean): Promise<void> {
  if (enabled) {
    const { error } = await client.from('user_source_subscriptions')
      .upsert({ user_id: userId, source_id: sourceId }, { onConflict: 'user_id,source_id', ignoreDuplicates: true });
    if (error) throw error;
  } else {
    const { error } = await client.from('user_source_subscriptions')
      .delete().eq('user_id', userId).eq('source_id', sourceId);
    if (error) throw error;
  }
}
