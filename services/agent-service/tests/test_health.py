"""/health and /version.

Both are unauthenticated, and the split matters: a smoke test that only checks
/health cannot tell a successful deploy from a silent rollback, because the
previous revision answers it just as happily.
"""

from fastapi.testclient import TestClient


def test_health_is_ok(client: TestClient) -> None:
    res = client.get("/health")
    assert res.status_code == 200
    assert res.json() == {"status": "ok"}


def test_health_needs_no_secret(client: TestClient, monkeypatch) -> None:
    """Cloud Run's probe has no secret to send, so health must never require one."""
    monkeypatch.setenv("AGENT_SERVICE_SECRET", "s3cret")
    assert client.get("/health").status_code == 200


def test_version_identifies_the_build(client: TestClient) -> None:
    body = client.get("/version").json()
    assert body["service"] == "mydeck-agent"
    assert body["contract_version"] == "1"
    # The field a rollback would change.
    assert body["revision"]


def test_version_reports_the_cloud_run_revision(client: TestClient, monkeypatch) -> None:
    monkeypatch.setenv("K_REVISION", "mydeck-agent-dev-00042-abc")
    assert client.get("/version").json()["revision"] == "mydeck-agent-dev-00042-abc"


def test_openapi_is_not_served(client: TestClient) -> None:
    """Ingress is public (§7.3), so the schema is not advertised there."""
    assert client.get("/openapi.json").status_code == 404
    assert client.get("/docs").status_code == 404
