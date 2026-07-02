import { useCallback, useEffect, useState } from "react";
import TraceDetailModal from "./TraceDetailModal";
import {
  Dashboard,
  HistoryDay,
  RunRow,
  TraceRow,
  fetchJson,
  postJson,
  statusClass,
} from "./api";

type Page = "dashboard" | "history" | "trace" | "runs";

export default function App({ page }: { page: Page }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyYear, setHistoryYear] = useState<number>(2025);
  const [historyFilter, setHistoryFilter] = useState<string>("all");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [traceDate, setTraceDate] = useState<string>("");

  const load = useCallback(async () => {
    setError(null);
    if (page === "dashboard") {
      setDash(await fetchJson<Dashboard>("/dashboard"));
    } else if (page === "history") {
      const d = await fetchJson<Dashboard>("/dashboard");
      setDash(d);
      const from = historyYear === 2025 ? "2025-01-01" : "2026-01-01";
      const to = historyYear === 2025 ? "2025-12-31" : "2026-06-30";
      setDays(await fetchJson<HistoryDay[]>(`/history/plan?from=${from}&to=${to}`));
    } else if (page === "trace") {
      const q = traceDate ? `&from=${traceDate}&to=${traceDate}` : "";
      setTraces(await fetchJson<TraceRow[]>(`/trace?page_size=200${q}`));
    } else {
      setRuns(await fetchJson<RunRow[]>("/runs"));
    }
  }, [page, historyYear, traceDate]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
    const t = setInterval(() => {
      load().catch((e) => setError(String(e)));
    }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const toggleSync = async (pause: boolean) => {
    setBusy(true);
    setError(null);
    try {
      await postJson(pause ? "/runs/pause" : "/runs/resume");
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (error) return <p className="error">{error}</p>;

  if (page === "dashboard" && dash) {
    const pollMin = Math.round(dash.poll_interval_sec / 60);
    return (
      <section>
        <h1>Dashboard histórico</h1>
        <p className="muted">
          Rango {dash.program_range_start} → {dash.program_range_end} ({dash.days_total}{" "}
          días programados)
        </p>
        <div className="card">
          <div className="progress">
            <div style={{ width: `${dash.percent}%` }} />
          </div>
          <p>
            {dash.days_completed} / {dash.days_total} días ({dash.percent}%)
          </p>
          <p>
            Mes activo: {dash.active_year ?? "—"}-
            {String(dash.active_month ?? "").padStart(2, "0")}
          </p>
          <p>
            Ventana n8n: {dash.current_window_start ?? "—"} →{" "}
            {dash.current_window_end ?? "—"}
          </p>
          <p>Próximo pendiente: {dash.first_pending ?? "ninguno"}</p>
          <p>
            Sincronización:{" "}
            <span className={dash.paused ? "status-error" : "status-ok"}>
              {dash.paused ? "PAUSADA" : "ACTIVA"}
            </span>
            {dash.scheduler_enabled
              ? ` — ciclo cada ${pollMin} min`
              : " — scheduler deshabilitado en servidor"}
          </p>
          {dash.last_poll_at && (
            <p className="muted">
              Último poll: {new Date(dash.last_poll_at).toLocaleString()}
            </p>
          )}
          <p>n8n API: {dash.n8n_configured ? "configurado" : "pendiente API key"}</p>

          <div className="btn-row">
            {dash.paused ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => toggleSync(false)}
              >
                Reanudar sincronización
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => toggleSync(true)}
              >
                Pausar sincronización
              </button>
            )}
          </div>
        </div>
      </section>
    );
  }

  if (page === "history") {
    const filtered = days.filter((d) => {
      if (historyFilter === "all") return true;
      if (historyFilter === "pending") return d.status === "pending";
      if (historyFilter === "completed") return d.status === "completed";
      return d.status !== "pending" && d.status !== "completed";
    });
    const completedCount = days.filter((d) => d.status === "completed").length;
    const pendingCount = days.filter((d) => d.status === "pending").length;

    return (
      <section>
        <h1>Planificación — días históricos</h1>
        <p className="muted">
          Datos de <code>email_history_day</code> + días pendientes del calendario (
          {dash?.program_range_start ?? "2025-01-01"} →{" "}
          {dash?.program_range_end ?? "2026-06-30"})
        </p>
        <div className="toolbar">
          <label>
            Año{" "}
            <select
              value={historyYear}
              onChange={(e) => setHistoryYear(Number(e.target.value))}
            >
              <option value={2025}>2025</option>
              <option value={2026}>2026 (ene–jun)</option>
            </select>
          </label>
          <label>
            Estado{" "}
            <select
              value={historyFilter}
              onChange={(e) => setHistoryFilter(e.target.value)}
            >
              <option value="all">Todos</option>
              <option value="completed">Completados</option>
              <option value="pending">Pendientes</option>
              <option value="other">Parcial / fallido</option>
            </select>
          </label>
          <span className="muted">
            {completedCount} completados · {pendingCount} pendientes en este año
          </span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Estado</th>
                <th>Listados</th>
                <th>Procesados</th>
                <th>Match</th>
                <th>Analizado</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((d) => (
                <tr key={d.analyzed_date}>
                  <td>{d.analyzed_date}</td>
                  <td>
                    <span className={statusClass(d.status)}>{d.status}</span>
                  </td>
                  <td>{d.emails_listed_count}</td>
                  <td>{d.emails_processed_count}</td>
                  <td>{d.emails_match_count}</td>
                  <td>
                    {d.analyzed_at
                      ? new Date(d.analyzed_at).toLocaleString()
                      : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    );
  }

  if (page === "trace") {
    return (
      <section>
        <h1>Correos con match</h1>
        <p className="muted">
          Pulsa <strong>Ver contenido</strong> para leer el cuerpo completo del correo.
        </p>
        <div className="toolbar">
          <label>
            Filtrar por día{" "}
            <input
              type="date"
              value={traceDate}
              min="2025-01-01"
              max="2026-06-30"
              onChange={(e) => setTraceDate(e.target.value)}
            />
          </label>
          {traceDate && (
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => setTraceDate("")}
            >
              Quitar filtro
            </button>
          )}
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Asunto</th>
                <th>De</th>
                <th>Telemetría</th>
                <th>Persona</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr key={t.message_id}>
                  <td>{t.email_date?.slice(0, 10) ?? "—"}</td>
                  <td>{t.subject ?? "—"}</td>
                  <td>{t.from_address ?? "—"}</td>
                  <td>{t.match_telemetria_keyword ?? "—"}</td>
                  <td>{t.match_person_keyword ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setSelectedMessageId(t.message_id)}
                    >
                      Ver contenido
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {selectedMessageId && (
          <TraceDetailModal
            messageId={selectedMessageId}
            onClose={() => setSelectedMessageId(null)}
          />
        )}
      </section>
    );
  }

  return (
    <section>
      <h1>Log de ejecuciones</h1>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Inicio</th>
              <th>Ventana</th>
              <th>Acción</th>
              <th>Estado</th>
              <th>Nota</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.started_at).toLocaleString()}</td>
                <td>
                  {r.window_start} → {r.window_end}
                </td>
                <td>{r.action}</td>
                <td>{r.status}</td>
                <td>{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
