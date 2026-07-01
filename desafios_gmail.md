# Desafíos Gmail — credenciales y ejecución en n8n telemetría

Guía de problemas frecuentes al conectar Gmail en la instancia
`https://ztrack.app/automatico/` (n8n telemetría, puerto 7001).

Relacionado: [fase_0.md](./fase_0.md) · [fase_1.md](./fase_1.md)

---

## Error: `Credential with ID "…" does not exist for type "gmailOAuth2"`

### Síntoma

Al ejecutar **Leer Gmail**:

```
Credential with ID "m9mZPcyo3p6ZFX2c" does not exist for type "gmailOAuth2". (item 0)
```

En la UI el nodo muestra **Gmail account** conectada y en *Credentials* aparece
*Account connected*, pero la ejecución falla.

### Qué significa

n8n guarda en el **workflow** una referencia por **ID interno** (ej. `m9mZPcyo3p6ZFX2c`),
no solo por nombre. Al ejecutar, el servidor busca ese ID en su base de credenciales
(SQLite del volumen `n8n_telemetria_data`).

El error indica: **el workflow apunta a un ID que ya no existe** en esta instancia.

La UI puede seguir mostrando el **nombre** "Gmail account" aunque el **ID** guardado
en el workflow esté roto (referencia huérfana).

---

## Causas habituales

| # | Causa | Cómo ocurre |
|---|--------|-------------|
| 1 | **Workflow importado sin reasignar** | `workflow.json` trae `"id": "REEMPLAZAR"`. Tras elegir credencial, no se **guardó** el workflow. |
| 2 | **Credencial borrada y recreada** | Mismo nombre "Gmail account", pero n8n asigna **nuevo ID**. El nodo sigue con el ID antiguo. |
| 3 | **Dos tipos de credencial Google** | Se creó **Google OAuth2 API** y luego **Gmail OAuth2 API**. El nodo solo usa `gmailOAuth2`; quedó un ID mezclado. |
| 4 | **Borrador vs publicado (n8n 2.x)** | Editas el borrador con credencial OK, pero ejecutas la **versión publicada** con ID viejo. |
| 5 | **Instancia nueva** | ID exportado de otro n8n (`:5678`) no existe en telemetría (`:7001`). |
| 6 | **"Lost connection to the server"** previo | Fallo de WebSocket; el guardado del workflow pudo no completarse. |

---

## Solución paso a paso (orden recomendado)

### Paso A — Re-vincular credencial en el nodo

1. Abre el workflow **Telemetria - Trazabilidad de correos (base)**.
2. Nodo **Leer Gmail** → campo **Credential**.
3. Elige **— Select credential —** (ninguna) o otra credencial temporal.
4. Vuelve a elegir **Gmail account** (tipo **Gmail OAuth2 API**).
5. **Guardar workflow** (Ctrl+S o botón Save arriba a la derecha).
6. Cierra y reabre el nodo; confirma que sigue seleccionada.
7. **Execute step** solo en **Leer Gmail** (con nodos anteriores ya ejecutados).

### Paso B — Publicar en n8n 2.x

Si usas flujos publicados:

1. Tras guardar, pulsa **Publish** (o *Publish workflow*).
2. Ejecuta de nuevo el workflow **publicado**.

La ejecución manual usa la versión publicada si el borrador no está sincronizado.

### Paso C — Recrear credencial (si A y B fallan)

1. **Credentials** → abre **Gmail account** → anota Client ID / Secret.
2. Crea credencial **nueva**: **Gmail OAuth2 API** (nombre ej. `Gmail telemetria v2`).
3. Mismo Client ID, Secret, scope `gmail.readonly`, **Connect my account**.
4. En **Leer Gmail** → selecciona la credencial **nueva**.
5. **Save** workflow → **Publish** si aplica.
6. Opcional: borra la credencial antigua para evitar confusiones.

### Paso D — Verificar tipo correcto

| Tipo en n8n | ¿Válido para Leer Gmail? |
|-------------|--------------------------|
| **Gmail OAuth2 API** | Sí |
| Google OAuth2 API | No (no enlaza al nodo Gmail) |

Redirect URI en Google Cloud:

```
https://ztrack.app/automatico/rest/oauth2-credential/callback
```

---

## Comprobar que quedó bien

1. **Leer Gmail** → Execute step → debe listar correos (o cero si el rango está vacío).
2. Sin error de credential ID en el panel OUTPUT.
3. En **Executions**, la ejecución debe completarse en el nodo Gmail.

Consulta rápida en Adminer no aplica aquí; el ID vive en la BD interna de n8n
(volumen Docker), no en Postgres `telemetria`.

---

## Prevención

1. Tras importar `workflow.json`, **reasignar credenciales y guardar** antes de ejecutar.
2. Usar siempre **Gmail OAuth2 API**, no Google OAuth2 API genérica.
3. Tras crear/borrar credenciales, **reabrir el nodo** y confirmar la selección.
4. En n8n 2.x: **Save + Publish** después de cambiar credenciales.
5. No copiar workflows exportados entre instancias n8n esperando que los IDs de
   credencial sigan válidos.

---

## Otros errores Gmail (referencia rápida)

| Error | Causa | Acción |
|-------|-------|--------|
| `redirect_uri_mismatch` | URI Google ≠ callback n8n | Añadir URI `/automatico/rest/oauth2-credential/callback` |
| No credentials yet | Tipo wrong o sin credencial | Crear **Gmail OAuth2 API** |
| Lost connection to the server | WebSocket proxy | Ver [fase_1.md](./fase_1.md) — Apache `rest/push` |
| Invalid credentials / 401 | Token revocado | Reconnect my account en la credencial |
| Simplify ON | Falta payload completo | **Simplify = OFF** en Leer Gmail |

---

## Checklist credencial Gmail OK

- [ ] Credencial tipo **Gmail OAuth2 API** (no Google OAuth2 API)
- [ ] *Account connected* en Credentials
- [ ] Nodo **Leer Gmail** con credencial seleccionada
- [ ] Workflow **guardado** (y **publicado** en n8n 2.x)
- [ ] Execute step en Leer Gmail sin error de ID
- [ ] Redirect URI correcta en Google Cloud
