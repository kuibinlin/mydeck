"""The application-specific controls the framework knows nothing about.

Everything here exists because registering a tool with an agent decides what is
ADVERTISED, and what is advertised and what can happen are different questions.
Each case below is a rule the Worker learned the hard way and that has to hold
one process further out.
"""

from typing import Any

from app.agent.meter import RunMeter
from app.agent.run import _uncounted_saves, run_turn
from app.agent.state import NO_ACTION_ROOM, TurnState
from app.providers.scripted import ScriptedChatModel, calls, says
from app.schemas import MAX_ACTIONS, MAX_DISCOVERED_WORDS, SaveWordsAction


async def run(make_request: Any, agent_config: Any, script: list[Any], **overrides: Any) -> Any:
    model = ScriptedChatModel(script=script)
    return await run_turn(make_request(**overrides), model=model, config=agent_config)


class TestSaveGate:
    async def test_a_withheld_save_tool_is_not_offered(self, make_request, agent_config):
        model = ScriptedChatModel(script=[says("A hospital.")])
        await run_turn(
            make_request(allowed_tools=["hsk_lookup", "create_activity"]),
            model=model,
            config=agent_config,
        )
        # A tool that isn't offered can't be called. Measured in the Worker: with
        # every argument optional, save became the cheapest call in the set and
        # two of three plain lookups created a deck nobody asked for.
        assert "save_words_to_deck" not in model.offered_tools

    async def test_an_attempt_at_a_withheld_save_is_still_counted(self, make_request, agent_config):
        """The one that matters.

        `saveFailed` is the only thing that can contradict a model claiming it
        saved, and the Worker gates it on this count. An attempt that reaches a
        withheld tool must still register, or the learner sees the claim and
        nothing else.
        """
        response = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"word_refs": [0]}), says("Added to your deck!")],
            allowed_tools=["hsk_lookup"],
        )

        assert response.save_attempts == 1
        assert response.intended_actions == []

    async def test_an_allowed_save_produces_an_action(self, make_request, agent_config):
        response = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"word_refs": [0]}), says("Saved.")],
        )
        assert response.save_attempts == 1
        assert len(response.intended_actions) == 1

    def test_an_ask_the_tool_body_never_saw_is_still_counted(self, make_request, agent_config):
        """The counting rule, stated as arithmetic: max(asked, counted).

        Two ways a call misses the counter inside the tool. A WITHHELD tool is
        never registered, so the framework answers "tool not found". A
        REGISTERED one whose arguments fail validation is rejected by the
        framework for a different reason and with the same result — and that
        second case used to return zero, because the old rule was "count from
        the meter only when the tool was withheld". `saveFailed` is gated on
        this number, so an uncounted ask is a claimed save with nothing in the
        app to contradict it.
        """
        state = TurnState.from_request(make_request(), agent_config)
        meter = RunMeter()
        meter.requested_tools = ["save_words_to_deck"]

        # Registered and allowed, but the body never ran — args were rejected.
        assert "save_words_to_deck" in state.allowed
        assert state.save_attempts == 0
        assert state.save_attempts + _uncounted_saves(state, meter) == 1

        # And a call that DID reach the body is not counted twice.
        state.save_attempts = 1
        assert state.save_attempts + _uncounted_saves(state, meter) == 1


class TestSeedInterception:
    async def test_a_resolved_word_is_answered_without_asking_the_dictionary(
        self, make_request, agent_config, dictionary
    ):
        """A guarantee, not a request.

        The prompt asks the model not to re-look-up a seeded word; measured in
        the Worker, it does anyway. Two things this buys: the round trip and its
        share of a rate budget shared with every other user, and the certainty
        that a word the learner typed is answered from the characters they
        typed rather than the model's copy of them.
        """
        response = await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "医院"}), says("A hospital.")],
        )

        assert dictionary.calls == []
        assert [(s.tool, s.ok) for s in response.steps] == [("hsk_lookup", True)]

    async def test_an_unresolved_word_still_goes_to_the_dictionary(
        self, make_request, agent_config, dictionary
    ):
        await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "银行"}), says("A bank.")],
        )
        assert dictionary.calls == [("hsk_lookup", {"word": "银行"})]

    async def test_a_word_that_missed_is_not_intercepted(
        self, make_request, agent_config, dictionary
    ):
        # found:false entries are sent so the tutor can say the word is not in
        # the list — they are not trusted records to answer from.
        await run(
            make_request,
            agent_config,
            [calls("hsk_lookup", {"word": "fanyi"}), says("Not in the list.")],
            known_words=[
                {"i": 0, "simplified": "fanyi", "found": False, "source": "seed"},
            ],
        )
        assert dictionary.calls == [("hsk_lookup", {"word": "fanyi"})]


class TestBudgets:
    async def test_the_tool_budget_is_separate_from_the_step_limit(
        self, agent_config, make_request
    ):
        # The step limit is about loop depth. The tool budget exists because the
        # dictionary's public endpoint allows 30 requests a minute across
        # everyone, and this is one turn's share of it.
        state = TurnState.from_request(make_request(), agent_config)
        state.tool_calls = agent_config.max_tool_calls

        stop = state.check("hsk_lookup", {"word": "医院"})
        assert stop is not None
        assert "answer the learner" in stop.lower()

    async def test_the_gate_checks_in_the_order_it_must(self, agent_config, make_request):
        """Allowlist, then budget, then repeats.

        A withheld tool must be refused as unknown even when the budget is also
        gone — the two answers say different things to the model, and one of them
        invites a retry.
        """
        state = TurnState.from_request(make_request(allowed_tools=["hsk_lookup"]), agent_config)
        state.tool_calls = agent_config.max_tool_calls

        assert state.check("save_words_to_deck", {}) == "Unknown tool: save_words_to_deck"

    async def test_the_action_cap_refuses_before_the_response_would_reject_it(
        self, agent_config, make_request
    ):
        """The tool budget is 6 and the response carries 4 actions.

        So six successful saves and activities was reachable, and
        `TurnResponse.intended_actions` refuses more than four — turning a turn
        where the model did MORE work into a ValidationError, a 500, and a
        learner with no reply. Refused at the gate instead, as a sentence the
        model can answer around.
        """
        state = TurnState.from_request(make_request(), agent_config)
        state.actions = [
            SaveWordsAction(type="save_words_to_deck", word_refs=[], deck_id=None, deck_name=None)
            for _ in range(MAX_ACTIONS)
        ]

        assert state.check("save_words_to_deck", {"deck_name": "x"}) == NO_ACTION_ROOM
        assert state.check("create_activity", {"type": "stroke"}) == NO_ACTION_ROOM
        # A lookup produces a step, not an action, so the cap does not touch it.
        assert state.check("hsk_lookup", {"word": "医院"}) is None

    async def test_discovered_words_stop_at_what_the_response_accepts(
        self, agent_config, make_request
    ):
        # A search returning more than the cap used to build a response the
        # service could not serialise — the whole reply lost over words nobody
        # asked for.
        state = TurnState.from_request(make_request(), agent_config)
        state.discover([chr(0x4E00 + n) for n in range(MAX_DISCOVERED_WORDS + 10)])

        assert len(state.discovered) == MAX_DISCOVERED_WORDS

    async def test_a_repeat_call_gets_a_nudge_instead_of_a_second_request(
        self, make_request, agent_config, dictionary
    ):
        """A weak model's most common failure is asking for the same thing twice.

        Answering from the cache breaks the cycle and doubles as the only
        rate-limit relief this service has.
        """
        response = await run(
            make_request,
            agent_config,
            [
                calls("hsk_lookup", {"word": "银行"}),
                calls("hsk_lookup", {"word": "银行"}),
                says("A bank."),
            ],
        )

        assert dictionary.calls == [("hsk_lookup", {"word": "银行"})]
        assert len(response.steps) == 1


class TestReferences:
    async def test_a_deck_the_worker_never_offered_is_dropped(self, make_request, agent_config):
        # The Worker refuses any id it did not send, so passing one through
        # costs the entire response. Dropped here instead.
        response = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"deck_id": 9999}), says("Saved.")],
            decks=[{"id": 3, "name": "HSK 3", "card_count": 5}],
        )
        assert response.intended_actions[0].deck_id is None

    async def test_a_deck_that_was_offered_survives(self, make_request, agent_config):
        response = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"deck_id": 3}), says("Saved.")],
            decks=[{"id": 3, "name": "HSK 3", "card_count": 5}],
        )
        assert response.intended_actions[0].deck_id == 3

    async def test_a_reference_to_an_unresolved_word_is_dropped(self, make_request, agent_config):
        response = await run(
            make_request,
            agent_config,
            [calls("save_words_to_deck", {"word_refs": [0, 1]}), says("Saved.")],
            known_words=[
                {
                    "i": 0,
                    "simplified": "医院",
                    "meaning": "hospital",
                    "found": True,
                    "source": "seed",
                },
                {"i": 1, "simplified": "zzz", "found": False, "source": "seed"},
            ],
        )
        # Index 1 names a word nothing resolved, so it cannot be saved.
        assert response.intended_actions[0].word_refs == [0]


class TestPromptSafety:
    async def test_the_known_words_are_numbered_for_the_model(self, make_request, agent_config):
        from app.agent import prompt

        text = prompt.build(
            make_request(
                known_words=[
                    {
                        "i": 0,
                        "simplified": "医院",
                        "pinyin": "yīyuàn",
                        "meaning": "hospital",
                        "level": 1,
                        "found": True,
                        "source": "seed",
                    },
                    {"i": 1, "simplified": "zzz", "found": False, "source": "seed"},
                ]
            )
        )

        assert "[0] 医院" in text
        assert "NOT in the HSK vocabulary list" in text
        # The whole reason the contract uses indices: this model corrupts
        # Chinese it retypes.
        assert "Never retype the characters" in text
