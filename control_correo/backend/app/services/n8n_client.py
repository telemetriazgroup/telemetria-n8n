from typing import Any, Optional

import httpx

from app.config import settings
from app.database import SessionLocal
from app.services.match_config import match_payload_for_n8n


class N8nClient:
    def __init__(self) -> None:
        self.base = settings.n8n_base_url.rstrip("/")
        self.headers = {}
        if settings.n8n_api_key:
            self.headers["X-N8N-API-KEY"] = settings.n8n_api_key

    def _client(self) -> httpx.Client:
        return httpx.Client(base_url=self.base, headers=self.headers, timeout=60.0)

    def configured(self) -> bool:
        return self.trigger_configured()

    def trigger_configured(self) -> bool:
        return bool(settings.n8n_webhook_path) or bool(
            settings.n8n_api_key and settings.n8n_workflow_id
        )

    def monitor_configured(self) -> bool:
        return bool(settings.n8n_api_key)

    def workflow_is_running(self) -> bool:
        if not self.monitor_configured():
            return False
        running = self.list_running_executions()
        wid = settings.n8n_workflow_id
        if wid:
            return any(str(ex.get("workflowId")) == wid for ex in running)
        return len(running) > 0

    def list_running_executions(self) -> list[dict[str, Any]]:
        if not self.monitor_configured():
            return []
        with self._client() as client:
            r = client.get("/api/v1/executions", params={"status": "running", "limit": 20})
            r.raise_for_status()
            data = r.json()
            return data.get("data", data if isinstance(data, list) else [])

    def stop_execution(self, execution_id: str) -> None:
        if not self.monitor_configured():
            return
        with self._client() as client:
            r = client.post(f"/api/v1/executions/{execution_id}/stop")
            if r.status_code not in (200, 204, 404):
                r.raise_for_status()

    def test_connection(self) -> dict[str, Any]:
        """Comprueba salud, webhook registrado y API sin lanzar el workflow."""
        path = (settings.n8n_webhook_path or "historico-run").lstrip("/")
        result: dict[str, Any] = {
            "base_url": self.base,
            "webhook_path": path,
            "health_ok": False,
            "health_detail": "",
            "webhook_ok": False,
            "webhook_detail": "",
            "api_ok": False,
            "api_detail": "",
            "workflow_active": None,
            "trigger_configured": self.trigger_configured(),
            "monitor_configured": self.monitor_configured(),
            "overall_ok": False,
        }

        try:
            with self._client() as client:
                hr = client.get("/healthz", timeout=15.0)
                result["health_ok"] = hr.status_code == 200
                result["health_detail"] = hr.text[:200] if hr.text else str(hr.status_code)
        except Exception as exc:
            result["health_detail"] = str(exc)

        try:
            with self._client() as client:
                wr = client.get(f"/webhook/{path}", timeout=15.0)
                body = wr.text
                if wr.status_code == 404 and "Did you mean to make a POST" in body:
                    result["webhook_ok"] = True
                    result["webhook_detail"] = "Webhook de producción registrado (acepta POST)"
                elif wr.status_code == 404 and "not registered" in body.lower():
                    result["webhook_detail"] = (
                        "Webhook no registrado — activa el workflow en n8n"
                    )
                elif wr.status_code in (200, 405):
                    result["webhook_ok"] = True
                    result["webhook_detail"] = f"Respuesta HTTP {wr.status_code}"
                else:
                    result["webhook_detail"] = f"HTTP {wr.status_code}: {body[:240]}"
        except Exception as exc:
            result["webhook_detail"] = str(exc)

        if self.monitor_configured() and settings.n8n_workflow_id:
            try:
                with self._client() as client:
                    wr = client.get(
                        f"/api/v1/workflows/{settings.n8n_workflow_id}",
                        timeout=15.0,
                    )
                    if wr.status_code == 200:
                        data = wr.json()
                        active = bool(data.get("active"))
                        result["workflow_active"] = active
                        result["api_ok"] = True
                        name = data.get("name", settings.n8n_workflow_id)
                        result["api_detail"] = (
                            f"Workflow «{name}» — "
                            f"{'activo' if active else 'INACTIVO (activar en n8n)'}"
                        )
                        if not active:
                            result["webhook_ok"] = result["webhook_ok"] and False
                    else:
                        result["api_detail"] = f"HTTP {wr.status_code}: {wr.text[:200]}"
            except Exception as exc:
                result["api_detail"] = str(exc)
        elif self.monitor_configured():
            try:
                with self._client() as client:
                    wr = client.get("/api/v1/workflows", params={"limit": 1}, timeout=15.0)
                    result["api_ok"] = wr.status_code == 200
                    result["api_detail"] = (
                        "API key válida"
                        if wr.status_code == 200
                        else f"HTTP {wr.status_code}"
                    )
            except Exception as exc:
                result["api_detail"] = str(exc)
        else:
            result["api_detail"] = "Sin N8N_API_KEY — solo prueba health + webhook"

        result["overall_ok"] = (
            result["health_ok"]
            and result["webhook_ok"]
            and (result["workflow_active"] is not False)
        )
        return result

    def _enrich_payload(self, payload: dict[str, Any]) -> dict[str, Any]:
        db = SessionLocal()
        try:
            payload.update(match_payload_for_n8n(db))
        finally:
            db.close()
        return payload

    def trigger_historical(
        self,
        start_date: str,
        end_date: str,
        *,
        slot_start_epoch: int | None = None,
        slot_end_epoch: int | None = None,
    ) -> Optional[str]:
        """Dispara workflow histórico (ventana de días o franja horaria opcional)."""
        payload: dict[str, Any] = {
            "mode": "historical",
            "startDate": start_date,
            "endDate": end_date,
            "batchSize": settings.n8n_batch_size,
            "tzOffsetHours": -5,
        }
        if slot_start_epoch is not None and slot_end_epoch is not None:
            payload["slotStartEpoch"] = slot_start_epoch
            payload["slotEndEpoch"] = slot_end_epoch
        return self._trigger_webhook(settings.n8n_webhook_path, self._enrich_payload(payload))

    def trigger_repair(
        self,
        *,
        process_date: str,
        message_ids: list[str],
    ) -> Optional[str]:
        payload = {
            "mode": "repair",
            "processDate": process_date,
            "startDate": process_date,
            "endDate": process_date,
            "messageIds": message_ids,
            "batchSize": settings.n8n_batch_size,
            "tzOffsetHours": -5,
            "skipKnownInDb": False,
        }
        return self._trigger_webhook(settings.n8n_webhook_path, self._enrich_payload(payload))

    def trigger_live_slot(
        self,
        *,
        process_date: str,
        slot_index: int,
        slot_start_epoch: int,
        slot_end_epoch: int,
        slot_label: str,
    ) -> Optional[str]:
        payload = {
            "mode": "live_today",
            "processDate": process_date,
            "startDate": process_date,
            "endDate": process_date,
            "slotIndex": slot_index,
            "slotStartEpoch": slot_start_epoch,
            "slotEndEpoch": slot_end_epoch,
            "slotLabel": slot_label,
            "batchSize": settings.n8n_batch_size,
            "tzOffsetHours": -5,
            "reviewMode": "incremental",
        }
        return self._trigger_webhook(settings.n8n_webhook_live_path, self._enrich_payload(payload))

    def _trigger_webhook(self, path_setting: str, payload: dict[str, Any]) -> Optional[str]:
        """Dispara workflow vía webhook (preferido) o API run."""
        path = (path_setting or "historico-run").lstrip("/")
        url = f"/webhook/{path}"
        try:
            with self._client() as client:
                r = client.post(url, json=payload)
                if r.status_code == 404:
                    test_url = f"/webhook-test/{path}"
                    r = client.post(test_url, json=payload)
                if r.status_code == 404 and settings.n8n_workflow_id and settings.n8n_api_key:
                    return self._trigger_via_api(payload)
                r.raise_for_status()
                if r.content:
                    try:
                        body = r.json()
                        eid = body.get("executionId") or body.get("id")
                        if eid:
                            return str(eid)
                    except Exception:
                        pass
                return "webhook-accepted"
        except httpx.HTTPError:
            if settings.n8n_workflow_id and settings.n8n_api_key:
                return self._trigger_via_api(payload)
            raise
        return None

    def _trigger_via_api(self, payload: dict[str, Any]) -> Optional[str]:
        if not settings.n8n_workflow_id:
            return None
        with self._client() as client:
            r = client.post(
                f"/api/v1/workflows/{settings.n8n_workflow_id}/run",
                json={"data": payload},
            )
            r.raise_for_status()
            data = r.json()
            return str(data.get("executionId") or data.get("id") or "")
