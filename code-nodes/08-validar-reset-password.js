// ── Validar contraseña de reinicio ──────────────────────────────────────────
// Entrada: nodo "Config reinicio" con resetPassword.
// Contraseña esperada: ZTRACKPERU2026

const RESET_PASSWORD = 'ZTRACKPERU2026';
const pwd = String($input.first().json.resetPassword || '').trim();

if (pwd !== RESET_PASSWORD) {
  throw new Error(
    'Contraseña de reinicio incorrecta. Operación cancelada. ' +
    'Indica ZTRACKPERU2026 en el nodo "Config reinicio" antes de ejecutar.'
  );
}

return [{
  json: {
    resetOk: true,
    resetAt: new Date().toISOString(),
    message:
      'Contraseña válida. Se marcarán como superseded los correos activos ' +
      'y se reprocesará el día de hoy desde el inicio.'
  }
}];
