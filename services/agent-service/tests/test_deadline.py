"""The clock.

Neither the step limit nor the tool budget is one. Four steps of a slow model,
or six tool calls against a slow dictionary, can outlast the Worker's patience
while every individual limit is still satisfied — and then this process carries
on past the point where anyone is listening, spending provider budget on an
abandoned request and holding a Cloud Run instance.

`delay_s` on the scripted model is what makes this testable without paying a
provider. It is also the knob for timing the real edge path by hand.
"""

from dataclasses import replace
from typing import Any

from app.agent.run import run_turn
from app.providers.scripted import ScriptedChatModel, calls, says


def impatient(agent_config: Any, seconds: float = 0.05) -> Any:
    return replace(agent_config, deadline_s=seconds)


class TestDeadline:
    async def test_a_slow_turn_ends_at_the_deadline(self, make_request, agent_config):
        model = ScriptedChatModel(script=[says("eventually")], delay_s=5)

        response = await run_turn(make_request(), model=model, config=impatient(agent_config))

        assert response.stopped_by == "step_limit"
        assert response.message == ""

    async def test_the_deadline_reports_a_finished_turn_not_a_failure(
        self, make_request, agent_config
    ):
        """`step_limit`, never `model_error`.

        The Worker answers a fast failure by running its own loop. Telling it
        this failed fast would make the learner wait a second time for a turn
        that was already too slow — the exact thing the timeout policy exists to
        avoid. A deadline is a completed turn that ran out of room.
        """
        model = ScriptedChatModel(script=[says("eventually")], delay_s=5)

        response = await run_turn(make_request(), model=model, config=impatient(agent_config))
        assert response.stopped_by != "model_error"

    async def test_no_rescue_call_is_made_after_the_clock_runs_out(
        self, make_request, agent_config
    ):
        """The empty-reply rescue is skipped once the deadline has passed.

        It would land after the Worker has already given up and degraded to the
        cards — a model call whose only possible reader has stopped listening.
        """
        model = ScriptedChatModel(script=[calls("hsk_lookup", {"word": "银行"})], delay_s=5)

        response = await run_turn(make_request(), model=model, config=impatient(agent_config))

        assert response.stopped_by == "step_limit"
        assert model.calls <= 1

    async def test_a_fast_turn_is_untouched(self, make_request, agent_config):
        response = await run_turn(
            make_request(),
            model=ScriptedChatModel(script=[says("医院 is a hospital.")]),
            config=impatient(agent_config, seconds=5),
        )
        assert response.stopped_by == "answered"
        assert response.message == "医院 is a hospital."


class TestBillingSurvivesABadEnding:
    async def test_calls_made_before_the_deadline_are_still_billed(
        self, make_request, agent_config
    ):
        """Measured from callbacks, not from the returned messages.

        A run that ends at the deadline returns no message list at all, so
        counting from it would bill zero for calls the provider has charged for.
        """
        model = ScriptedChatModel(
            script=[calls("hsk_lookup", {"word": "医院"}), says("slow")],
            delay_s=0.02,
        )

        response = await run_turn(
            make_request(), model=model, config=impatient(agent_config, seconds=0.03)
        )

        assert response.stopped_by == "step_limit"
        assert response.usage.model_calls >= 1

    async def test_a_refused_save_is_counted_even_when_the_turn_times_out(
        self, make_request, agent_config
    ):
        """`saveFailed` has to survive the worst ending, not just the good one.

        The attempt is read off the meter, which watches the model's output, so
        it is captured whether or not the run ever returns a message list.
        """
        model = ScriptedChatModel(
            script=[calls("save_words_to_deck", {"word_refs": [0]}), says("Added!")],
            delay_s=0.02,
        )

        response = await run_turn(
            make_request(allowed_tools=["hsk_lookup"]),
            model=model,
            config=impatient(agent_config, seconds=0.03),
        )

        assert response.save_attempts == 1
        assert response.intended_actions == []
