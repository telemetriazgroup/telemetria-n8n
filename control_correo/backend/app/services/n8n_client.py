from typing import Any, Optional

import httpx

from app.config import settings


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

    def trigger_historical(self, start_date: str, end_date: str) -> Optional[str]:
        """Dispara workflow vía webhook (preferido) o API run."""
        payload = {
            "mode": "historical",
            "startDate": start_date,
            "endDate": end_date,
        }
        path = (settings.n8n_webhook_path or "historico-run").lstrip("/")
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
