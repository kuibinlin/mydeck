"""POST /internal/agent/turn — the endpoint and its gate.

Schema rules that need no HTTP live in test_contract.py; what is here is what
only the running app can answer.
"""

from typing import Any

from fastapi.testclient import TestClient

from .conftest import TURN_URL


def test_valid_turn_runs_the_agent(client: TestClient, payload: dict[str, Any]) -> None:
    res = client.post(TURN_URL, json=payload)
    assert res.status_code == 200

    body = res.json()
    assert body["contract_version"] == "1"
    assert body["message"]
    assert body["intended_actions"] == []
    assert body["discovered_words"] == []
    assert body["save_attempts"] == 0
    assert body["stopped_by"] == "answered"
    # A real model call happened, against the scripted provider the test
    # environment pins — see tests/test_safety.py.
    assert body["usage"]["model_calls"] == 1


def test_request_id_is_echoed(client: TestClient, payload: dict[str, Any]) -> None:
    """The Worker discards a response it cannot tie to its own request."""
    payload["request_id"] = "abc-987"
    assert client.post(TURN_URL, json=payload).json()["request_id"] == "abc-987"


def test_minimal_turn_is_enough(client: TestClient) -> None:
    """known_words, decks and level are all optional — a first turn has none."""
    res = client.post(
        TURN_URL,
        json={
            "contract_version": "1",
            "request_id": "r1",
            "messages": [{"role": "user", "content": "hello"}],
            "allowed_tools": ["hsk_lookup"],
        },
    )
    assert res.status_code == 200


def test_secret_is_required_when_configured(
    client: TestClient, payload: dict[str, Any], monkeypatch
) -> None:
    monkeypatch.setenv("AGENT_SERVICE_SECRET", "s3cret")

    assert client.post(TURN_URL, json=payload).status_code == 401
    assert (
        client.post(TURN_URL, json=payload, headers={"X-MyDeck-Agent-Secret": "wrong"}).status_code
        == 401
    )
    assert (
        client.post(TURN_URL, json=payload, headers={"X-MyDeck-Agent-Secret": "s3cret"}).status_code
        == 200
    )


def test_missing_secret_fails_closed_on_cloud_run(
    client: TestClient, payload: dict[str, Any], monkeypatch
) -> None:
    """An unconfigured secret is open ingress, so the deployed case refuses to serve.

    K_SERVICE is set on every Cloud Run instance and nowhere else, which is what
    lets local development stay frictionless without leaving production open.
    """
    monkeypatch.delenv("AGENT_SERVICE_SECRET", raising=False)
    monkeypatch.setenv("K_SERVICE", "mydeck-agent-dev")

    assert client.post(TURN_URL, json=payload).status_code == 503


def test_unauthenticated_turn_says_nothing_about_the_payload(
    client: TestClient, monkeypatch
) -> None:
    """The gate runs before validation, so a prober cannot map the schema by 422s."""
    monkeypatch.setenv("AGENT_SERVICE_SECRET", "s3cret")
    assert client.post(TURN_URL, json={"garbage": True}).status_code == 401
