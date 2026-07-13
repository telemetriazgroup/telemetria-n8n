import { FormEvent, useCallback, useEffect, useState } from "react";
import {
  MatchConfig,
  ResetMailResult,
  fetchJson,
  formatDateTime,
  putJson,
  postJson,
} from "./api";

function linesToList(text: string): string[] {
  return text
   .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function listToLines(items: string[]): string {
  return items.join("\n");
}

export default function SettingsPage() {
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [telemetriaText, setTelemetriaText] = useState("");
  const [personText, setPersonText] = useState("");
  const [resetPassword, setResetPassword] = useState("");
  const [resetConfirm, setResetConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const cfg = await fetchJson<MatchConfig>("/admin/match-config");
    setConfig(cfg);
    setTelemetriaText(listToLines(cfg.telemetria_variants));
    setPersonText(listToLines(cfg.person_keywords));
  }, []);

  useEffect(() => {
    load().catch((e: Error) => setError(e.message));
  }, [load]);

  async function saveMatchConfig(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await putJson<MatchConfig>("/admin/match-config", {
        telemetria_variants: linesToList(telemetriaText),
        person_keywords: linesToList(personText),
      });
      setConfig(updated);
      setTelemetriaText(listToLines(updated.telemetria_variants));
      setPersonText(listToLines(updated.person_keywords));
      setMessage("Palabras de match guardadas. Los próximos sync usarán esta configuración.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function resetMailData(e: FormEvent) {
    e.preventDefault();
    if (!resetConfirm) {
      setError("Marca la casilla de confirmación antes de resetear.");
      return;
    }
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const result = await postJson<ResetMailResult>("/admin/reset-mail-data", {
        password: resetPassword,
      });
      const total = Object.values(result.cleared).reduce((a, b) => a + b, 0);
      setMessage(
        `Reset completado: ${total} filas eliminadas (correos, días, slots y logs).`
      );
      setResetPassword("");
      setResetConfirm(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <h1>Configuración</h1>
      <p className="muted">
        Palabras de match (insensible a mayúsculas y acentos) y reset de datos de
        correo. La configuración de match se conserva al resetear.
      </p>

      {error && <p className="error-banner">{error}</p>}
      {message && <p className="ok-banner">{message}</p>}

      <div className="settings-grid">
        <form className="card" onSubmit={saveMatchConfig}>
          <h2>Palabras de match</h2>
          <p className="muted">
            Una palabra por línea. Debe coincidir al menos una de telemetría y una
            de persona (p. ej. <code>telemetría</code>, <code>madurador</code>,{" "}
            <code>Luis</code>).
          </p>
          <label>
            Variantes telemetría / producto
            <textarea
              rows={10}
              value={telemetriaText}
              onChange={(e) => setTelemetriaText(e.target.value)}
              disabled={busy}
            />
          </label>
          <label>
            Personas
            <textarea
              rows={5}
              value={personText}
              onChange={(e) => setPersonText(e.target.value)}
              disabled={busy}
            />
          </label>
          {config?.updated_at && (
            <p className="muted small">
              Última actualización: {formatDateTime(config.updated_at)}
            </p>
          )}
          <button type="submit" className="btn btn-primary" disabled={busy}>
            Guardar palabras
          </button>
        </form>

        <form className="card card-danger" onSubmit={resetMailData}>
          <h2>Reset de base de datos</h2>
          <p className="muted">
            Borra correos match, correos procesados, días históricos, franjas live
            y log de ejecuciones. No borra el calendario ni las palabras de match.
          </p>
          <label>
            Contraseña
            <input
              type="password"
              value={resetPassword}
              onChange={(e) => setResetPassword(e.target.value)}
              autoComplete="off"
              disabled={busy}
            />
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={resetConfirm}
              onChange={(e) => setResetConfirm(e.target.checked)}
              disabled={busy}
            />
            Entiendo que se perderán todos los correos y logs procesados
          </label>
          <button type="submit" className="btn btn-danger" disabled={busy}>
            Resetear datos de correo
          </button>
        </form>
      </div>
    </section>
  );
}
