const API = "/api/v1";

export async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export type Dashboard = {
  days_completed: number;
  days_total: number;
  percent: number;
  active_year: number | null;
  active_month: number | null;
  current_window_start: string | null;
  current_window_end: string | null;
  first_pending: string | null;
  paused: boolean;
  last_poll_at: string | null;
  n8n_configured: boolean;
  program_range_start: string;
  program_range_end: string;
};

export type HistoryDay = {
  analyzed_date: string;
  status: string;
  emails_listed_count: number;
  emails_processed_count: number;
  emails_match_count: number;
  analyzed_at: string;
};

export type TraceRow = {
  message_id: string;
  subject: string | null;
  from_address: string | null;
  email_date: string | null;
  match_person_keyword: string | null;
  gmail_link: string | null;
};

export type RunRow = {
  id: number;
  started_at: string;
  window_start: string;
  window_end: string;
  action: string;
  status: string;
  note: string | null;
};
