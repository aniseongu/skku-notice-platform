import type { SupabaseClient } from '@supabase/supabase-js';

export async function loadSaveCounts(client: SupabaseClient, ids: string[]): Promise<Map<string, number> | null> {
  const counts = new Map<string, number>();
  for (let i = 0; i < ids.length; i += 500) {
    const batch = ids.slice(i, i + 500);
    const { data, error } = await client.rpc('notice_save_counts', { p_ids: batch });
    if (error) return null;
    for (const id of batch) counts.set(id, 0);
    for (const row of data ?? []) if (batch.includes(row.notice_id) && Number.isInteger(row.saves) && row.saves > 0) counts.set(row.notice_id, row.saves);
  }
  return counts;
}
