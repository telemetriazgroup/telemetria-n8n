import { useCallback, useEffect, useState } from "react";
import TraceDetailModal from "./TraceDetailModal";
import { renderCompactMatchPreview, renderSubjectWithMatch } from "./matchHighlight";
import {
  Dashboard,
  HistoryDay,
  N8nTestResult,
  RunRow,
  TraceRow,
  ProcessedRow,
  actionLabel,
  addDays,
  datetimeLocalToIso,
  fetchJson,
  formatDateTime,
  historyYearOptions,
  monthDateRange,
  MONTH_LABELS,
  postJson,
  statusClass,
  statusLabel,
  yearDateRange,
} from "./api";

type Page = "dashboard" | "history" | "trace" | "processed" | "runs";

export default function App({ page }: { page: Page }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [processed, setProcessed] = useState<ProcessedRow[]>([]);
  const [processedFilter, setProcessedFilter] = useState<"all" | "match" | "no_match">("all");
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [historyYear, setHistoryYear] = useState<number>(2025);
  const [historyMonth, setHistoryMonth] = useState<number>(0);
  const [historyFilter, setHistoryFilter] = useState<string>("all");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [selectedDetailPath, setSelectedDetailPath] = useState<"trace" | "processed">("trace");
  const [traceRangeActive, setTraceRangeActive] = useState(false);
  const [traceFromDt, setTraceFromDt] = useState<string>("");
  const [traceToDt, setTraceToDt] = useState<string>("");
  const [traceDraftFrom, setTraceDraftFrom] = useState<string>("");
  const [traceDraftTo, setTraceDraftTo] = useState<string>("");
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
      const progStart = d.program_range_start;
      const raw =
        historyMonth === 0
          ? yearDateRange(historyYear)
          : monthDateRange(historyYear, historyMonth);
      const from = raw.from < progStart ? progStart : raw.from;
      setDays(await fetchJson<HistoryDay[]>(`/history/plan?from=${from}&to=${raw.to}`));
    } else if (page === "trace" || page === "processed") {
      const d = await fetchJson<Dashboard>("/dashboard");
      setDash(d);
      const rangeQuery =
        traceRangeActive && traceFromDt && traceToDt
          ? `&from_dt=${encodeURIComponent(datetimeLocalToIso(traceFromDt))}&to_dt=${encodeURIComponent(datetimeLocalToIso(traceToDt))}`
          : "";
      const pageSize = traceRangeActive ? 200 : 20;
      if (page === "trace") {
        setTraces(
          await fetchJson<TraceRow[]>(`/trace?page_size=${pageSize}${rangeQuery}`)
        );
      } else {
        const matchQuery =
          processedFilter === "match"
            ? "&match_only=true"
            : processedFilter === "no_match"
              ? "&match_only=false"
              : "";
        setProcessed(
          await fetchJson<ProcessedRow[]>(
            `/processed?page_size=${pageSize}${rangeQuery}${matchQuery}`
          )
        );
      }
    } else {
      setRuns(await fetchJson<RunRow[]>("/runs?limit=100"));
    }
  }, [page, historyYear, historyMonth, traceRangeActive, traceFromDt, traceToDt, processedFilter, manualStart]);

  useEffect(() => {
    load().catch((e) => setError(String(e)));
    const pollMs =
      page === "dashboard" && dash?.sync_in_progress
        ? 15000
        : page === "dashboard"
          ? 30000
          : 30000;
    const t = setInterval(() => {
      load().catch((e) => setError(String(e)));
    }, pollMs);
    return () => clearInterval(t);
  }, [load, page, dash?.sync_in_progress]);

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
    const pollMin = Math.round(dash.watchdog_interval_sec / 60);
    const dayLabel = dash.processing_date ?? dash.first_pending ?? "—";
    return (
      <section>
        <h1>Dashboard histórico</h1>
        <p className="muted">
          Barrido automático hasta {dash.program_range_end}
          {dash.sync_end_dynamic ? " (ayer, GMT-5)" : ""} · exploración hasta{" "}
          {dash.program_history_end ?? dash.program_view_end ?? dash.program_range_end} ·{" "}
          {dash.days_total} días programados (auto)
        </p>

        <div className="card card-secondary">
          <h2>Barrido histórico automático</h2>
          <p className="muted">
            Recorre solo los días pendientes hasta {dash.program_range_end}
            {dash.sync_end_dynamic ? " (ayer Lima)" : ""}. El watchdog revisa cada{" "}
            {pollMin} min si hay que lanzar el siguiente día.
          </p>
          <label className="checkbox-row toggle-row">
            <input
              type="checkbox"
              checked={dash.historical_auto_sync_enabled}
              disabled={busy}
              onChange={(e) =>
                runAction(async () =>
                  postJson("/runs/historical-auto", { enabled: e.target.checked })
                )
              }
            />
            Activar recorrido automático de días históricos faltantes
          </label>
          {dash.historical_auto_sync_enabled ? (
            <p>
              Estado:{" "}
              <span className={dash.paused ? "status-warn" : "status-ok"}>
                {dash.paused ? "Pausado — no avanza hasta reanudar" : "En marcha"}
              </span>
              {dash.scheduler_enabled
                ? ` · watchdog cada ${pollMin} min`
                : " · scheduler desactivado en servidor"}
            </p>
          ) : (
            <p className="muted">
              Modo manual: tú eliges las fechas en «Sincronización manual» más abajo.
            </p>
          )}
        </div>

        {dash.live_today?.enabled && (
          <div className="card card-live">
            <h2>Hoy en vivo — {dash.live_today.today_date}</h2>
            <p className="muted">
              Ciclo cada {Math.round(dash.live_today.interval_sec / 60)} min · franjas de{" "}
              {dash.live_today.slot_minutes} min (America/Lima). Al cambiar el día, se archiva
              en histórico.
            </p>
            <div className="progress progress-live">
              <div style={{ width: `${dash.live_today.percent}%` }} />
            </div>
            <p>
              <strong>Franjas:</strong> {dash.live_today.slots_completed} /{" "}
              {dash.live_today.slots_total} ({dash.live_today.percent}%) ·{" "}
              <strong>Hasta ahora ({dash.live_today.current_time_lima ?? "—"}):</strong>{" "}
              {dash.live_today.slots_completed} / {dash.live_today.slots_expected_by_now ?? 0}{" "}
              ({dash.live_today.percent_expected ?? 0}%) ·{" "}
              <strong>Pendientes:</strong> {dash.live_today.slots_pending_now ?? 0}
            </p>
            {dash.live_today.last_poll_at && (
              <p className="muted">
                Último ciclo live: {new Date(dash.live_today.last_poll_at).toLocaleString()}
              </p>
            )}
            <div className="live-slots-grid">
              {dash.live_today.slots.map((s) => (
                <div
                  key={s.slot_index}
                  className={`live-slot live-slot-${s.status}`}
                  title={`${s.label} — ${s.status} · match/procesados · listados ${s.emails_listed}`}
                >
                  <span className="live-slot-label">{s.label}</span>
                  <span className="live-slot-meta live-slot-ratio">
                    {s.emails_match}/{s.emails_processed}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="card">
          <div className="progress">
            <div style={{ width: `${dash.percent}%` }} />
          </div>
          <p>
            <strong>Días procesados:</strong> {dash.days_completed} / {dash.days_total} (
            {dash.percent}%)
          </p>
          <p>
            <strong>Días con match:</strong> {dash.days_with_match} ·{" "}
            <strong>Correos match (total):</strong> {dash.total_match_emails}
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
            Histórico:{" "}
            {dash.historical_auto_sync_enabled ? (
              <>
                <span className={dash.paused ? "status-error" : "status-ok"}>
                  {dash.paused ? "PAUSADO" : "AUTO ACTIVO"}
                </span>
                {dash.scheduler_enabled
                  ? ` — watchdog cada ${pollMin} min`
                  : " — scheduler off"}
              </>
            ) : (
              <span className="status-ok">MANUAL (solo tú lanzas días)</span>
            )}
            {" · "}
            Live:{" "}
            <span className={dash.live_today?.enabled ? "status-ok" : "status-pending"}>
              {dash.live_today?.enabled
                ? `auto cada ${Math.round((dash.live_today?.interval_sec ?? 600) / 60)} min`
                : "off"}
            </span>
          </p>
          <p className="muted">
            Sectores de <strong>{dash.batch_size}</strong> correos por vuelta del bucle n8n.
            El live de hoy sigue automático según la hora Lima.
          </p>
          {dash.last_poll_at && (
            <p className="muted">
              Último seguimiento: {new Date(dash.last_poll_at).toLocaleString()}
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
            <button
              type="button"
              className="btn btn-ghost"
              disabled={busy}
              onClick={() => runAction(async () => postJson("/runs/reconcile"))}
            >
              Reconciliar logs
            </button>
            {dash.historical_auto_sync_enabled &&
              (dash.paused ? (
                <button
                  type="button"
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => runAction(async () => postJson("/runs/resume"))}
                >
                  Reanudar barrido
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-danger"
                  disabled={busy}
                  onClick={() => runAction(async () => postJson("/runs/pause"))}
                >
                  Pausar barrido
                </button>
              ))}
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

        {(dash.sync_in_progress || dash.processing_date) && (
          <div className={`card card-secondary ${dash.sync_in_progress ? "card-active-flow" : ""}`}>
            <h2>
              {dash.sync_in_progress ? "Proceso en curso" : "Día en seguimiento"}
              {dash.n8n_flow_active && (
                <span className="flow-pulse"> · n8n ejecutando</span>
              )}
            </h2>
            <p>
              <strong>Día:</strong> {dayLabel}{" "}
              {dash.day_status && (
                <span className={statusClass(dash.day_status)}>{dash.day_status}</span>
              )}
            </p>
            {dash.day_listed > 0 ? (
              <>
                <div className="progress progress-day">
                  <div style={{ width: `${Math.min(dash.day_percent, 100)}%` }} />
                </div>
                <p>
                  Correos del día: <strong>{dash.day_processed}</strong> / {dash.day_listed}{" "}
                  procesados ({dash.day_percent}%) · <strong>{dash.day_match}</strong> con match
                </p>
              </>
            ) : (
              <p className="muted">
                Sin listado aún en BD para este día (pendiente o sin correos).
              </p>
            )}
            {dash.active_run_started_at && (
              <p className="muted">
                Lote iniciado: {formatDateTime(dash.active_run_started_at)}
                {dash.active_run_id ? ` (run #${dash.active_run_id})` : ""}
              </p>
            )}
          </div>
        )}

        {(dash.historical_auto_sync_enabled ? dash.paused : true) && (
          <div className="card card-secondary">
            <h2>Sincronización manual (histórico)</h2>
            <p className="muted">
              Elige la ventana de fechas y lanza n8n. Usa «Reparar» en Días históricos si faltan
              trazas en <code>email_trace</code>.
            </p>
            <div className="toolbar">
              <label>
                Desde{" "}
                <input
                  type="date"
                  value={manualStart}
                  min={dash.program_range_start}
                  max={dash.program_view_end ?? dash.program_range_end}
                  onChange={(e) => onManualStartChange(e.target.value)}
                />
              </label>
              <label>
                Hasta{" "}
                <input
                  type="date"
                  value={manualEnd}
                  min={manualStart || dash.program_range_start}
                  max={dash.program_view_end ?? dash.program_range_end}
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
      if (historyFilter === "partial") return d.status === "partial";
      return d.status !== "pending" && d.status !== "completed" && d.status !== "partial";
    });
    const completedCount = days.filter((d) => d.status === "completed").length;
    const pendingCount = days.filter((d) => d.status === "pending").length;
    const partialCount = days.filter((d) => d.status === "partial").length;
    const monthLabel =
      MONTH_LABELS.find((m) => m.value === historyMonth)?.label ?? "Todos los meses";
    const historyYears = historyYearOptions(
      dash?.program_range_start ?? "2025-01-01",
      dash?.program_history_end ?? dash?.program_view_end
    );

    return (
      <section>
        <h1>Planificación — días históricos</h1>
        <p className="muted">
          Datos de <code>email_history_day</code> + días pendientes (
          {dash?.program_range_start ?? "2025-01-01"} →{" "}
          {dash?.program_history_end ?? dash?.program_view_end ?? dash?.program_range_end ?? "—"})
        </p>
        <div className="toolbar toolbar-wrap">
          <label>
            Año{" "}
            <select
              value={historyYear}
              onChange={(e) => setHistoryYear(Number(e.target.value))}
            >
              {historyYears.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mes{" "}
            <select
              value={historyMonth}
              onChange={(e) => setHistoryMonth(Number(e.target.value))}
            >
              {MONTH_LABELS.map((m) => (
                <option key={m.value} value={m.value}>
                  {m.label}
                </option>
              ))}
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
              <option value="partial">Parcial (lotes)</option>
              <option value="other">Fallido / otro</option>
            </select>
          </label>
          <span className="muted">
            {historyYear} · {monthLabel}: {completedCount} completados · {partialCount}{" "}
            parcial · {pendingCount} pendientes
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
                <th>Reparar</th>
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
                  <td>
                    {d.emails_match_count > 0 && d.status !== "pending" ? (
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={busy}
                        onClick={() =>
                          runAction(async () => {
                            const r = await postJson<{ repaired: number; message?: string }>(
                              `/history/days/${d.analyzed_date}/repair`
                            );
                            if (r.repaired === 0) {
                              alert(r.message ?? "Sin IDs faltantes en email_trace");
                            }
                          })
                        }
                      >
                        Reparar trazas
                      </button>
                    ) : (
                      "—"
                    )}
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
    const applyTraceRange = () => {
      if (!traceDraftFrom || !traceDraftTo) return;
      setTraceFromDt(traceDraftFrom);
      setTraceToDt(traceDraftTo);
      setTraceRangeActive(true);
    };

    const clearTraceRange = () => {
      setTraceRangeActive(false);
      setTraceFromDt("");
      setTraceToDt("");
      setTraceDraftFrom("");
      setTraceDraftTo("");
    };

    return (
      <section>
        <h1>Correos con match</h1>
        <p className="muted">
          Por defecto se muestran los <strong>últimos 20</strong> correos con match
          (histórico + hoy en vivo).
          Pulsa <strong>Ver contenido</strong> para leer el cuerpo completo.
        </p>
        <div className="card card-secondary trace-filters">
          <h2>Filtro por fecha y hora</h2>
          <div className="toolbar toolbar-wrap">
            <label>
              Desde{" "}
              <input
                type="datetime-local"
                value={traceDraftFrom}
                min="2025-01-01T00:00"
                max={`${dash?.program_history_end ?? dash?.program_view_end ?? "2099-12-31"}T23:59`}
                onChange={(e) => setTraceDraftFrom(e.target.value)}
              />
            </label>
            <label>
              Hasta{" "}
              <input
                type="datetime-local"
                value={traceDraftTo}
                min={traceDraftFrom || "2025-01-01T00:00"}
                max={`${dash?.program_history_end ?? dash?.program_view_end ?? "2099-12-31"}T23:59`}
                onChange={(e) => setTraceDraftTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!traceDraftFrom || !traceDraftTo}
              onClick={applyTraceRange}
            >
              Aplicar rango
            </button>
            {traceRangeActive && (
              <button type="button" className="btn btn-ghost" onClick={clearTraceRange}>
                Ver últimos 20
              </button>
            )}
          </div>
          {traceRangeActive && traceFromDt && traceToDt && (
            <p className="muted">
              Rango activo: {formatDateTime(datetimeLocalToIso(traceFromDt))} →{" "}
              {formatDateTime(datetimeLocalToIso(traceToDt))} · hasta 200 resultados
            </p>
          )}
        </div>
        <p className="muted">
          {traceRangeActive
            ? `Mostrando ${traces.length} correo(s) en el rango`
            : `Mostrando los últimos ${traces.length} correo(s)`}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha / hora</th>
                <th>Asunto</th>
                <th>Fragmento match</th>
                <th>De</th>
                <th>Telemetría</th>
                <th>Persona</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {traces.map((t) => (
                <tr key={t.message_id}>
                  <td>{formatDateTime(t.email_date)}</td>
                  <td className="match-cell">
                    {renderSubjectWithMatch(t.subject, {
                      telemetriaKeyword: t.match_telemetria_keyword,
                      personKeyword: t.match_person_keyword,
                      telemetriaExcerpt: t.match_telemetria_excerpt,
                      personExcerpt: t.match_person_excerpt,
                    })}
                  </td>
                  <td className="match-cell match-cell-preview">
                    {renderCompactMatchPreview({
                      telemetriaKeyword: t.match_telemetria_keyword,
                      personKeyword: t.match_person_keyword,
                      telemetriaExcerpt: t.match_telemetria_excerpt,
                      personExcerpt: t.match_person_excerpt,
                    })}
                  </td>
                  <td>{t.from_address ?? "—"}</td>
                  <td>{t.match_telemetria_keyword ?? "—"}</td>
                  <td>{t.match_person_keyword ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setSelectedDetailPath("trace");
                        setSelectedMessageId(t.message_id);
                      }}
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
            detailPath={selectedDetailPath}
            onClose={() => setSelectedMessageId(null)}
          />
        )}
      </section>
    );
  }

  if (page === "processed") {
    const applyTraceRange = () => {
      if (!traceDraftFrom || !traceDraftTo) return;
      setTraceFromDt(traceDraftFrom);
      setTraceToDt(traceDraftTo);
      setTraceRangeActive(true);
    };

    const clearTraceRange = () => {
      setTraceRangeActive(false);
      setTraceFromDt("");
      setTraceToDt("");
      setTraceDraftFrom("");
      setTraceDraftTo("");
    };

    return (
      <section>
        <h1>Todos los correos</h1>
        <p className="muted">
          Correos leídos y guardados en la base de datos (con y sin match). Los que
          coinciden con las palabras configuradas aparecen marcados como{" "}
          <span className="badge-match">Match</span>.
        </p>
        <div className="card card-secondary trace-filters">
          <h2>Filtros</h2>
          <div className="toolbar toolbar-wrap">
            <label>
              Tipo{" "}
              <select
                value={processedFilter}
                onChange={(e) =>
                  setProcessedFilter(e.target.value as "all" | "match" | "no_match")
                }
              >
                <option value="all">Todos</option>
                <option value="match">Solo con match</option>
                <option value="no_match">Solo sin match</option>
              </select>
            </label>
            <label>
              Desde{" "}
              <input
                type="datetime-local"
                value={traceDraftFrom}
                min="2025-01-01T00:00"
                max={`${dash?.program_history_end ?? dash?.program_view_end ?? "2099-12-31"}T23:59`}
                onChange={(e) => setTraceDraftFrom(e.target.value)}
              />
            </label>
            <label>
              Hasta{" "}
              <input
                type="datetime-local"
                value={traceDraftTo}
                min={traceDraftFrom || "2025-01-01T00:00"}
                max={`${dash?.program_history_end ?? dash?.program_view_end ?? "2099-12-31"}T23:59`}
                onChange={(e) => setTraceDraftTo(e.target.value)}
              />
            </label>
            <button
              type="button"
              className="btn btn-primary"
              disabled={!traceDraftFrom || !traceDraftTo}
              onClick={applyTraceRange}
            >
              Aplicar rango
            </button>
            {traceRangeActive && (
              <button type="button" className="btn btn-ghost" onClick={clearTraceRange}>
                Ver últimos 20
              </button>
            )}
          </div>
          {traceRangeActive && traceFromDt && traceToDt && (
            <p className="muted">
              Rango activo: {formatDateTime(datetimeLocalToIso(traceFromDt))} →{" "}
              {formatDateTime(datetimeLocalToIso(traceToDt))} · hasta 200 resultados
            </p>
          )}
        </div>
        <p className="muted">
          {traceRangeActive
            ? `Mostrando ${processed.length} correo(s) en el rango`
            : `Mostrando los últimos ${processed.length} correo(s)`}
        </p>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Fecha / hora</th>
                <th>Asunto</th>
                <th>Fragmento</th>
                <th>De</th>
                <th>Match</th>
                <th>Modo</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {processed.map((p) => (
                <tr key={p.message_id} className={p.is_match ? "row-match" : undefined}>
                  <td>{formatDateTime(p.email_date)}</td>
                  <td className="match-cell">
                    {p.is_match
                      ? renderSubjectWithMatch(p.subject, {
                          telemetriaKeyword: p.match_telemetria_keyword,
                          personKeyword: p.match_person_keyword,
                          telemetriaExcerpt: p.match_telemetria_excerpt,
                          personExcerpt: p.match_person_excerpt,
                        })
                      : (p.subject ?? "—")}
                  </td>
                  <td className="match-cell match-cell-preview">
                    {p.is_match
                      ? renderCompactMatchPreview({
                          telemetriaKeyword: p.match_telemetria_keyword,
                          personKeyword: p.match_person_keyword,
                          telemetriaExcerpt: p.match_telemetria_excerpt,
                          personExcerpt: p.match_person_excerpt,
                        })
                      : (p.snippet?.slice(0, 120) ?? "—")}
                  </td>
                  <td>{p.from_address ?? "—"}</td>
                  <td>
                    {p.is_match ? (
                      <span className="badge-match">Match</span>
                    ) : (
                      <span className="badge-muted">—</span>
                    )}
                  </td>
                  <td>{p.review_mode ?? "—"}</td>
                  <td>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => {
                        setSelectedDetailPath("processed");
                        setSelectedMessageId(p.message_id);
                      }}
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
            detailPath={selectedDetailPath}
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
        Inicios, pausas, reanudaciones, cancelaciones, timeouts, lotes parciales
        (<code>batch_partial</code>) y cierre de día (<code>batch_day_completed</code>).
        Solo debe haber una fila «En curso» a la vez.
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
