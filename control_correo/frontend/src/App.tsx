import { useEffect, useState } from "react";
import {
  Dashboard,
  HistoryDay,
  RunRow,
  TraceRow,
  fetchJson,
} from "./api";

type Page = "dashboard" | "history" | "trace" | "runs";

export default function App({ page }: { page: Page }) {
  const [dash, setDash] = useState<Dashboard | null>(null);
  const [days, setDays] = useState<HistoryDay[]>([]);
  const [traces, setTraces] = useState<TraceRow[]>([]);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const load = async () => {
      try {
        setError(null);
        if (page === "dashboard") {
          setDash(await fetchJson<Dashboard>("/dashboard"));
        } else if (page === "history") {
          setDays(await fetchJson<HistoryDay[]>("/history/days?from=2026-01-01&to=2027-06-30"));
        } else if (page === "trace") {
          setTraces(await fetchJson<TraceRow[]>("/trace?page_size=100"));
        } else {
          setRuns(await fetchJson<RunRow[]>("/runs"));
        }
      } catch (e) {
        setError(String(e));
      }
    };
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [page]);

  if (error) return <p className="error">{error}</p>;

  if (page === "dashboard" && dash) {
    return (
      <section>
        <h1>Dashboard histórico</h1>
        <p className="muted">
          Rango {dash.program_range_start} → {dash.program_range_end}
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
          <p>Scheduler: {dash.paused ? "PAUSADO" : "activo"}</p>
          <p>n8n API: {dash.n8n_configured ? "configurado" : "pendiente API key"}</p>
        </div>
      </section>
    );
  }

  if (page === "history") {
    return (
      <section>
        <h1>Días analizados</h1>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Estado</th>
              <th>Listados</th>
              <th>Procesados</th>
              <th>Match</th>
            </tr>
          </thead>
          <tbody>
            {days.map((d) => (
              <tr key={d.analyzed_date}>
                <td>{d.analyzed_date}</td>
                <td>{d.status}</td>
                <td>{d.emails_listed_count}</td>
                <td>{d.emails_processed_count}</td>
                <td>{d.emails_match_count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  if (page === "trace") {
    return (
      <section>
        <h1>Correos con match</h1>
        <table>
          <thead>
            <tr>
              <th>Fecha</th>
              <th>Asunto</th>
              <th>De</th>
              <th>Persona</th>
              <th>Gmail</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((t) => (
              <tr key={t.message_id}>
                <td>{t.email_date?.slice(0, 10) ?? "—"}</td>
                <td>{t.subject ?? "—"}</td>
                <td>{t.from_address ?? "—"}</td>
                <td>{t.match_person_keyword ?? "—"}</td>
                <td>
                  {t.gmail_link ? (
                    <a href={t.gmail_link} target="_blank" rel="noreferrer">
                      abrir
                    </a>
                  ) : (
                    "—"
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    );
  }

  return (
    <section>
      <h1>Log de ejecuciones</h1>
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
    </section>
  );
}
