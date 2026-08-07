"""The loop, driven by a scripted model.

With the model's judgement out of the picture, what is left under test is the
wiring: did the tool run, did the result come back, did the right intended
action fall out, and does the response say honestly what happened.

Same approach as backend/test/tutor.test.js, which scripts `callModel` for the
same reason.
"""

from typing import Any

import pytest

from app.agent.run import run_turn
from app.providers.scripted import ScriptedChatModel, calls, says


async def run(make_request: Any, agent_config: Any, script: list[Any], **overrides: Any) -> Any:
    model = ScriptedChatModel(script=script)
    response = await run_turn(make_request(**overrides), model=model, config=agent_config)
    return response, model


class TestPlainAnswer:
    async def test_answers_without_tools(self, make_request, agent_config):
        response, _ = await run(
            make_request, agent_config, [says("医院 is the everyday word for a hospital.")]
        )

        assert response.message == "医院 is the everyday word for a hospital."
        assert response.stopped_by == "answered"
        assert response.steps == []
        assert response.intended_actions == []

    async def test_echoes_the_request_id(self, make_request, agent_config):
        response, _ = await run(make_request, agent_config, [says("hi")], request_id="abc-99")
        assert response.request_id == "abc-99"

    async def test_bills_every_model_call(self, make_request, agent_config):
        # Quota is per call, not per request: the Worker writes one usage row
        # for each, so a two-step turn has to say two.
        response, _ = await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "医院"}), says("A hospital.")],
        )
        assert response.usage.model_calls == 2
        assert response.usage.input_tokens > 0


class TestTools:
    async def test_a_lookup_runs_and_is_recorded(self, make_request, agent_config, dictionary):
        response, _ = await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "银行"}), says("A bank.")],
        )

        assert [(s.tool, s.ok) for s in response.steps] == [("hsk_lookup", False)]
        assert dictionary.calls == [("hsk_lookup", {"word": "银行"})]

    async def test_only_allowed_tools_are_advertised(self, make_request, agent_config):
        _, model = await run(
            make_request,
            agent_config,
            [says("ok")],
            allowed_tools=["hsk_lookup"],
        )
        assert model.offered_tools == ["hsk_lookup"]

    async def test_a_tool_result_reaches_the_next_model_turn(
        self, make_request, agent_config, dictionary
    ):
        dictionary.answers(
            "hsk_lookup",
            {
                "results": [
                    {
                        "simplified": "银行",
                        "new_level": 1,
                        "forms": [{"pinyin": "yínháng", "meanings": ["bank"]}],
                    }
                ]
            },
        )

        _, model = await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "银行"}), says("A bank.")],
        )

        # The second model turn must be able to see what the first one learned.
        transcript = str(model.seen[-1])
        assert "yínháng" in transcript


class TestSaving:
    async def test_produces_an_intended_action_rather_than_a_write(
        self, make_request, agent_config
    ):
        response, _ = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"word_refs": [0]}), says("Saving that now.")],
        )

        assert len(response.intended_actions) == 1
        action = response.intended_actions[0]
        assert action.type == "save_words_to_deck"
        assert action.word_refs == [0]
        assert response.save_attempts == 1

    async def test_naming_nothing_means_what_we_discussed(self, make_request, agent_config):
        response, _ = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {}), says("Saved.")],
        )
        # Not a missing argument — the Worker resolves an empty list against its
        # own knownWords().
        assert response.intended_actions[0].word_refs == []

    async def test_a_named_deck_travels_as_a_name(self, make_request, agent_config):
        response, _ = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"deck_name": "Hospital words"}), says("Saved.")],
        )
        assert response.intended_actions[0].deck_name == "Hospital words"


class TestActivities:
    async def test_produces_an_intended_action(self, make_request, agent_config):
        response, _ = await run(
            make_request,
            agent_config,
            [
                calls("create_activity", {"type": "match", "word_refs": [0]}),
                says("Here is a quick game."),
            ],
        )

        action = response.intended_actions[0]
        assert action.type == "create_activity"
        assert action.activity_type == "match"
        assert action.word_refs == [0]

    async def test_inherits_the_learners_level_when_none_is_given(self, make_request, agent_config):
        # The learner answered this in the empty state; their answer holds
        # whether or not the model thought to pass it on.
        response, _ = await run(
            make_request,
            agent_config,
            [calls("create_activity", {"type": "stroke"}), says("Practise these.")],
        )
        assert response.intended_actions[0].level == 3

    async def test_an_unknown_type_is_refused_without_an_action(self, make_request, agent_config):
        response, _ = await run(
            make_request,
            agent_config,
            [calls("create_activity", {"type": "stroke_sheet"}), says("Sorry.")],
        )

        assert response.intended_actions == []
        assert [(s.tool, s.ok) for s in response.steps] == [("create_activity", False)]


class TestStopping:
    async def test_reports_the_step_limit(self, make_request, agent_config):
        # A model that never stops calling tools. The loop has to end, and say
        # why, rather than run until something else stops it.
        response, _ = await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "医院"})],
        )
        assert response.stopped_by in ("step_limit", "answered_after_cap")

    async def test_asks_for_prose_when_the_run_produced_none(self, make_request, agent_config):
        # Measured in the Worker: four tool calls and an empty reply renders as
        # a card with an unexplained silence beside it.
        model = ScriptedChatModel(script=[calls("hsk_search", {"query": "hospital"}), says("")])
        # The scripted model repeats its last turn, so once the script runs out
        # every further call answers with "". The nudge call is the one that
        # gets a real sentence.
        model.script = [
            calls("hsk_search", {"query": "hospital"}),
            says(""),
            says("医院 is the word you want."),
        ]
        response = await run_turn(make_request(), model=model, config=agent_config)

        assert response.message == "医院 is the word you want."
        assert response.stopped_by == "answered_after_cap"

    async def test_a_model_failure_is_reported_not_raised(self, make_request, agent_config):
        class Broken(ScriptedChatModel):
            def _generate(self, *args: object, **kwargs: object) -> object:
                raise RuntimeError("provider exploded")

        response = await run_turn(make_request(), model=Broken(), config=agent_config)

        # The Worker treats a 5xx as a reason to spend a second model budget.
        # This failed for a reason a retry will not fix, so it comes back as a
        # turn that happened and produced nothing.
        assert response.stopped_by == "model_error"
        assert response.message == ""


class TestDiscoveredWords:
    async def test_carries_words_a_result_produced(self, make_request, agent_config, dictionary):
        dictionary.answers(
            "hsk_search_meaning",
            {
                "results": [
                    {"simplified": "银行", "forms": [{"pinyin": "yínháng", "meanings": ["bank"]}]}
                ]
            },
        )

        response, _ = await run(
            make_request,
            agent_config,
            [calls("hsk_search", {"query": "bank"}), says("银行 is the word.")],
        )

        # Han-only strings. The Worker re-resolves them; nothing about their
        # meaning crosses.
        assert response.discovered_words == ["银行"]

    async def test_does_not_repeat_a_word_the_worker_already_sent(
        self, make_request, agent_config, dictionary
    ):
        dictionary.answers(
            "hsk_search_meaning",
            {"results": [{"simplified": "医院", "forms": [{"meanings": ["hospital"]}]}]},
        )

        response, _ = await run(
            make_request,
            agent_config,
            [calls("hsk_search", {"query": "hospital"}), says("医院.")],
        )
        assert response.discovered_words == []


@pytest.mark.parametrize(
    ("sent", "expected"),
    [
        ([0], [0]),
        ("[0]", [0]),  # a JSON array arriving as a string
        ("0", [0]),  # a scalar where a list belongs
        (0, [0]),
        ([0.0], [0]),  # a float for an integer
        ("0, 0", [0]),  # comma-separated, deduplicated
        ([99], []),  # names nothing real
        (None, []),
        ("nonsense", []),
    ],
)
async def test_word_refs_are_repaired_not_rejected(
    make_request, agent_config, sent: Any, expected: list[int]
):
    """Models get argument types wrong on essentially every call.

    Repaired where the meaning is unambiguous, dropped where it is not — and a
    reference to nothing falls back to "the words we have been discussing",
    which is a better answer than failing the turn.
    """
    response, _ = await run(
        make_request,
        agent_config,
        [calls("save_words_to_deck", {"word_refs": sent}), says("Saved.")],
    )
    assert response.intended_actions[0].word_refs == expected


async def test_an_unbuildable_provider_is_a_turn_not_a_crash(make_request, agent_config):
    """No key, unknown model name — the endpoint must still answer.

    A 500 from /internal/agent/turn is something the Worker can only report as
    "the tutor is unavailable"; a turn that says model_error is something it can
    fall back from and something a log can explain.
    """
    from dataclasses import replace

    from app.agent.run import run_turn

    broken = replace(agent_config, provider="openai", model="", api_key=None, base_url="::::")
    response = await run_turn(make_request(), config=broken)

    assert response.stopped_by == "model_error"
    assert response.message == ""
