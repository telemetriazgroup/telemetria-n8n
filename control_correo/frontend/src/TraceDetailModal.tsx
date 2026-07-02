import { useEffect, useState } from "react";
import { TraceDetail, fetchJson } from "./api";

type Props = {
  messageId: string;
  onClose: () => void;
};

export default function TraceDetailModal({ messageId, onClose }: Props) {
  const [detail, setDetail] = useState<TraceDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setDetail(null);
    setError(null);
    fetchJson<TraceDetail>(`/trace/${encodeURIComponent(messageId)}`)
      .then((d) => {
        if (!cancelled) setDetail(d);
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [messageId]);

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
      >
        <header className="modal-header">
          <h2>{detail?.subject ?? "Detalle del correo"}</h2>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Cerrar
          </button>
        </header>

        {error && <p className="error">{error}</p>}
        {!detail && !error && <p className="muted">Cargando…</p>}

        {detail && (
          <div className="modal-body">
            <dl className="meta-grid">
              <dt>Fecha</dt>
              <dd>{detail.email_date?.slice(0, 19) ?? "—"}</dd>
              <dt>De</dt>
              <dd>{detail.from_address ?? "—"}</dd>
              <dt>Para</dt>
              <dd>{detail.to_addresses ?? "—"}</dd>
              <dt>CC</dt>
              <dd>{detail.cc_addresses ?? "—"}</dd>
              <dt>Match telemetría</dt>
              <dd>{detail.match_telemetria_keyword ?? "—"}</dd>
              <dt>Match persona</dt>
              <dd>{detail.match_person_keyword ?? "—"}</dd>
            </dl>

            {detail.match_telemetria_excerpt && (
              <section>
                <h3>Extracto telemetría</h3>
                <pre className="excerpt">{detail.match_telemetria_excerpt}</pre>
              </section>
            )}
            {detail.match_person_excerpt && (
              <section>
                <h3>Extracto persona</h3>
                <pre className="excerpt">{detail.match_person_excerpt}</pre>
              </section>
            )}

            <section>
              <h3>Contenido</h3>
              <pre className="body-text">
                {detail.body_text?.trim() || detail.snippet || "(sin cuerpo)"}
              </pre>
            </section>

            {detail.attachments?.length > 0 && (
              <section>
                <h3>Adjuntos</h3>
                <ul>
                  {detail.attachments.map((a) => (
                    <li key={a.attachment_id ?? a.filename ?? Math.random()}>
                      {a.filename ?? "adjunto"}{" "}
                      {a.mime_type ? `(${a.mime_type})` : ""}
                      {a.gmail_link ? (
                        <>
                          {" "}
                          <a href={a.gmail_link} target="_blank" rel="noreferrer">
                            abrir
                          </a>
                        </>
                      ) : null}
                    </li>
                  ))}
                </ul>
              </section>
            )}

            <div className="modal-actions">
              {detail.gmail_link && (
                <a
                  className="btn btn-primary"
                  href={detail.gmail_link}
                  target="_blank"
                  rel="noreferrer"
                >
                  Abrir en Gmail
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
