/**
 * The one definition of open competitor topics: the newest feed window's
 * topics that nobody dismissed. It lives in the database
 * (open_competitor_topics, migration 20261019210000_shared_layers.sql) so the
 * dashboard, the feed page and the weekly planner read the same rows.
 */

import { supabase } from "@/integrations/supabase/client";

export type OpenTopic = {
  id: string;
  client_id: string;
  window_start: string;
  window_end: string;
  topic: string;
  topic_key: string;
  summary: string | null;
  companies: string[];
  platforms: string[];
  post_urls: string[];
  post_count: number;
  confidence: number;
  status: string;
  created_at: string;
};

export async function fetchOpenTopics(clientId: string): Promise<OpenTopic[]> {
  // The function is newer than the generated types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase.rpc as any)("open_competitor_topics", { p_client_id: clientId });
  if (error) throw error;
  return (data ?? []) as OpenTopic[];
}
