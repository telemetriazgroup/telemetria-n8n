const API = "/api/v1";

export async function fetchJson<T>(path: string): Promise<T> {
  const r = await fetch(`${API}${path}`);
  if (!r.ok) throw new Error(await r.text());
  return r.json();
}

export async function postJson<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(`${API}${path}`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
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
  active_n8n_execution_id: string | null;
  n8n_running_count: number;
  program_range_start: string;
  program_range_end: string;
  poll_interval_sec: number;
  watchdog_interval_sec: number;
  exec_timeout_min: number;
  scheduler_enabled: boolean;
};

export type N8nTestResult = {
  base_url: string;
  webhook_path: string;
  health_ok: boolean;
  health_detail: string;
  webhook_ok: boolean;
  webhook_detail: string;
  api_ok: boolean;
  api_detail: string;
  workflow_active: boolean | null;
  trigger_configured: boolean;
  monitor_configured: boolean;
  overall_ok: boolean;
};

export type HistoryDay = {
  analyzed_date: string;
  status: string;
  emails_listed_count: number;
  emails_processed_count: number;
  emails_match_count: number;
  analyzed_at?: string | null;
  gmail_query?: string | null;
  scheduled?: boolean;
};

export type TraceRow = {
  message_id: string;
  thread_id?: string;
  subject: string | null;
  from_address: string | null;
  email_date: string | null;
  match_telemetria_keyword: string | null;
  match_person_keyword: string | null;
  gmail_link: string | null;
  reviewed_at?: string | null;
};

export type TraceAttachment = {
  filename: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  attachment_id: string | null;
  gmail_link: string | null;
};

export type TraceDetail = TraceRow & {
  to_addresses: string | null;
  cc_addresses: string | null;
  body_text: string | null;
  snippet: string | null;
  match_telemetria_excerpt: string | null;
  match_person_excerpt: string | null;
  search_query: string | null;
  attachments: TraceAttachment[];
};

export type RunRow = {
  id: number;
  started_at: string;
  finished_at: string | null;
  window_start: string;
  window_end: string;
  action: string;
  status: string;
  n8n_execution_id: string | null;
  note: string | null;
};

export function statusClass(status: string): string {
  if (status === "completed") return "status-ok";
  if (status === "pending") return "status-pending";
  if (status === "running") return "status-warn";
  if (status === "partial") return "status-warn";
  if (status === "failed") return "status-error";
  if (status === "cancelled") return "status-error";
  return "";
}

export function actionLabel(action: string): string {
  const map: Record<string, string> = {
    launch: "Inicio sync",
    retry_same: "Reintento",
    slide_window: "Deslizar ventana",
    stop: "Parada / cancelación",
    wait: "Prueba / espera",
  };
  return map[action] ?? action;
}

export function statusLabel(status: string): string {
  const map: Record<string, string> = {
    running: "En curso",
    completed: "Completado",
    failed: "Fallido",
    cancelled: "Cancelado",
    timeout: "Timeout",
  };
  return map[status] ?? status;
}

export function addDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
