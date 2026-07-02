import { useCallback, useEffect, useState } from "react";
import TraceDetailModal from "./TraceDetailModal";
import {
  Dashboard,
  HistoryDay,
  N8nTestResult,
  RunRow,
  TraceRow,
  actionLabel,
  addDays,
  fetchJson,
  postJson,
  statusClass,
  statusLabel,
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
  const [n8nTest, setN8nTest] = useState<N8nTestResult | null>(null);
  const [manualStart, setManualStart] = useState<string>("");
  const [manualEnd, setManualEnd] = useState<string>("");

  const load = useCallback(async () => {
    setError(null);
    if (page === "dashboard") {
      const d = await fetchJson<Dashboard>("/dashboard");
      setDash(d);
      if (!manualStart && d.first_pending) {
        setManualStart(d.first_pending);
        setManualEnd(addDays(d.first_pending, 1));
      }
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
      setRuns(await fetchJson<RunRow[]>("/runs?limit=100"));
    }
  }, [page, historyYear, traceDate, manualStart]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
    const t = setInterval(() => {
      load().catch((e) => setError(String(e)));
    }, 30000);
    return () => clearInterval(t);
  }, [load]);

  const runAction = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const onManualStartChange = (value: string) => {
    setManualStart(value);
    if (value) setManualEnd(addDays(value, 1));
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
          {dash.n8n_running_count > 0 && (
            <p className="status-warn">
              n8n en ejecución ({dash.n8n_running_count}) — id:{" "}
              {dash.active_n8n_execution_id ?? "—"}
            </p>
          )}
          <p>n8n: {dash.n8n_configured ? "configurado" : "pendiente webhook o API key"}</p>

          <div className="btn-row">
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() =>
                runAction(async () => {
                  setN8nTest(await postJson<N8nTestResult>("/runs/test-n8n"));
                })
              }
            >
              Probar enlace n8n
            </button>
            {dash.paused ? (
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => runAction(async () => postJson("/runs/resume"))}
              >
                Reanudar automático
              </button>
            ) : (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => runAction(async () => postJson("/runs/pause"))}
              >
                Pausar sincronización
              </button>
            )}
            {(dash.n8n_running_count > 0 || dash.active_n8n_execution_id) && (
              <button
                type="button"
                className="btn btn-danger"
                disabled={busy}
                onClick={() => runAction(async () => postJson("/runs/cancel"))}
              >
                Cancelar ejecución n8n
              </button>
            )}
          </div>

          {n8nTest && (
            <div className={`test-result ${n8nTest.overall_ok ? "test-ok" : "test-fail"}`}>
              <strong>
                Prueba n8n: {n8nTest.overall_ok ? "OK" : "REVISAR"}
              </strong>
              <ul>
                <li>
                  Health ({n8nTest.base_url}):{" "}
                  {n8nTest.health_ok ? "OK" : n8nTest.health_detail}
                </li>
                <li>
                  Webhook /{n8nTest.webhook_path}:{" "}
                  {n8nTest.webhook_ok ? "OK" : n8nTest.webhook_detail}
                </li>
                <li>API: {n8nTest.api_detail || (n8nTest.api_ok ? "OK" : "—")}</li>
                {n8nTest.workflow_active === false && (
                  <li className="status-error">Workflow inactivo en n8n</li>
                )}
              </ul>
            </div>
          )}
        </div>

        {dash.paused && (
          <div className="card card-secondary">
            <h2>Sincronización manual</h2>
            <p className="muted">
              Con la sync pausada, elige la ventana de fechas (par de días consecutivos)
              y lanza n8n directamente.
            </p>
            <div className="toolbar">
              <label>
                Desde{" "}
                <input
                  type="date"
                  value={manualStart}
                  min={dash.program_range_start}
                  max={dash.program_range_end}
                  onChange={(e) => onManualStartChange(e.target.value)}
                />
              </label>
              <label>
                Hasta{" "}
                <input
                  type="date"
                  value={manualEnd}
                  min={manualStart || dash.program_range_start}
                  max={dash.program_range_end}
                  onChange={(e) => setManualEnd(e.target.value)}
                />
              </label>
            </div>
            <button
              type="button"
              className="btn btn-primary"
              disabled={busy || !manualStart || !manualEnd}
              onClick={() =>
                runAction(async () =>
                  postJson("/runs/trigger", {
                    start_date: manualStart,
                    end_date: manualEnd,
                  })
                )
              }
            >
              Sincronizar esta ventana
            </button>
          </div>
        )}
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
          Datos de <code>email_history_day</code> + días pendientes (
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
      <p className="muted">
        Inicios, pausas, reanudaciones, cancelaciones y pruebas de enlace n8n.
      </p>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Inicio</th>
              <th>Fin</th>
              <th>Ventana</th>
              <th>Evento</th>
              <th>Estado</th>
              <th>n8n id</th>
              <th>Detalle</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.started_at).toLocaleString()}</td>
                <td>
                  {r.finished_at
                    ? new Date(r.finished_at).toLocaleString()
                    : r.status === "running"
                      ? "—"
                      : "—"}
                </td>
                <td>
                  {r.window_start} → {r.window_end}
                </td>
                <td>{actionLabel(r.action)}</td>
                <td>
                  <span className={statusClass(r.status)}>{statusLabel(r.status)}</span>
                </td>
                <td>{r.n8n_execution_id ?? "—"}</td>
                <td>{r.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
