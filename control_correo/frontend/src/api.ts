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
  days_with_match: number;
  total_match_emails: number;
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
  n8n_flow_active: boolean;
  sync_in_progress: boolean;
  active_run_id: number | null;
  active_run_started_at: string | null;
  processing_date: string | null;
  day_status: string | null;
  day_listed: number;
  day_processed: number;
  day_match: number;
  day_percent: number;
  batch_size: number;
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
  match_telemetria_excerpt?: string | null;
  match_person_excerpt?: string | null;
  snippet?: string | null;
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
    batch_partial: "Lote parcial (sector)",
    batch_day_completed: "Día completado",
    completed: "Ventana completada",
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

export function clipDateRange(
  from: string,
  to: string,
  min: string,
  max: string
): { from: string; to: string } {
  const f = from < min ? min : from;
  const t = to > max ? max : to;
  return f <= t ? { from: f, to: t } : { from: f, to: f };
}

export function yearDateRange(year: number, programEnd = "2026-06-30"): { from: string; to: string } {
  if (year === 2025) return { from: "2025-01-01", to: "2025-12-31" };
  return { from: "2026-01-01", to: programEnd };
}

export function monthDateRange(year: number, month: number): { from: string; to: string } {
  const mm = String(month).padStart(2, "0");
  const lastDay = new Date(year, month, 0).getDate();
  return {
    from: `${year}-${mm}-01`,
    to: `${year}-${mm}-${String(lastDay).padStart(2, "0")}`,
  };
}

export const MONTH_LABELS: { value: number; label: string }[] = [
  { value: 0, label: "Todos los meses" },
  { value: 1, label: "Enero" },
  { value: 2, label: "Febrero" },
  { value: 3, label: "Marzo" },
  { value: 4, label: "Abril" },
  { value: 5, label: "Mayo" },
  { value: 6, label: "Junio" },
  { value: 7, label: "Julio" },
  { value: 8, label: "Agosto" },
  { value: 9, label: "Septiembre" },
  { value: 10, label: "Octubre" },
  { value: 11, label: "Noviembre" },
  { value: 12, label: "Diciembre" },
];

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString();
}

/** Convierte valor de input datetime-local a ISO para la API. */
export function datetimeLocalToIso(value: string): string {
  if (!value) return "";
  return new Date(value).toISOString();
}
