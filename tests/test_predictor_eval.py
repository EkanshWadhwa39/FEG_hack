"""Tests for the offline prefetch-policy evaluation."""

from __future__ import annotations

import io
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "tools"))

from predictor_eval import (  # noqa: E402
    POLICIES,
    build_models,
    evaluate,
    policy_markov,
    policy_popular,
    policy_repeat,
    read_sequences,
)

HEADER = "event_name,session,timestamp,game_name\n"


def log(*rows: tuple[str, str, str]) -> io.StringIO:
    body = "".join(f"casino_game_launch,{s},{t},{g}\n" for s, t, g in rows)
    return io.StringIO(HEADER + body)


def test_sequences_are_ordered_by_time_within_a_session():
    seqs = read_sequences(log(
        ("s1", "2026-01-01T00:00:03Z", "C"),
        ("s1", "2026-01-01T00:00:01Z", "A"),
        ("s1", "2026-01-01T00:00:02Z", "B"),
    ), train_fraction=0.0)
    assert seqs.test == [["A", "B", "C"]]


def test_rows_without_a_usable_title_or_session_are_dropped():
    seqs = read_sequences(log(
        ("s1", "2026-01-01T00:00:01Z", "null"),
        ("s1", "2026-01-01T00:00:02Z", ""),
        ("", "2026-01-01T00:00:03Z", "A"),
        ("s1", "", "B"),
        ("s1", "2026-01-01T00:00:04Z", "Real"),
    ), train_fraction=0.0)
    assert seqs.test == [["Real"]]


def test_non_launch_events_are_ignored():
    stream = io.StringIO(HEADER + "screen_view,s1,2026-01-01T00:00:01Z,A\n")
    assert read_sequences(stream, train_fraction=0.0).test == []


def test_split_is_time_ordered_so_the_model_never_sees_the_future():
    seqs = read_sequences(log(
        ("late", "2026-06-01T00:00:00Z", "L"),
        ("early", "2026-01-01T00:00:00Z", "E"),
    ), train_fraction=0.5)
    assert seqs.train == [["E"]]
    assert seqs.test == [["L"]]


def test_test_cases_counts_only_predictable_launches():
    seqs = read_sequences(log(
        ("s1", "2026-01-01T00:00:01Z", "A"),
        ("s2", "2026-02-01T00:00:01Z", "B"),
        ("s2", "2026-02-01T00:00:02Z", "C"),
        ("s2", "2026-02-01T00:00:03Z", "D"),
    ), train_fraction=0.0)
    # Single-launch sessions offer nothing to predict; s2 offers two.
    assert seqs.test_cases == 2


def test_models_learn_popularity_and_next_title_transitions():
    models = build_models([["A", "B"], ["A", "B"], ["A", "C"]])
    assert models["popularity"]["A"] == 3
    assert models["follows"]["A"]["B"] == 2
    assert models["follows"]["A"]["C"] == 1
    # Self-transitions are not treated as a prediction signal.
    assert build_models([["A", "A"]])["follows"]["A"]["A"] == 0


def test_policies_respect_k_and_see_only_the_past():
    models = build_models([["A", "B"], ["A", "B"], ["X", "Y"]])
    assert policy_popular(["A"], models, 2) == ["A", "B"]
    assert policy_markov(["A"], models, 1) == ["B"]
    # Most recent first, de-duplicated.
    assert policy_repeat(["A", "B", "A"], models, 3) == ["A", "B"]
    for policy in POLICIES.values():
        assert len(policy(["A"], models, 2)) <= 2


def test_evaluation_counts_a_hit_only_when_the_actual_title_is_warmed():
    # In test session ["A", "B"], history ["A"] must predict "B".
    seqs = read_sequences(log(
        ("train", "2026-01-01T00:00:01Z", "A"),
        ("train", "2026-01-01T00:00:02Z", "B"),
        ("test", "2026-06-01T00:00:01Z", "A"),
        ("test", "2026-06-01T00:00:02Z", "B"),
    ), train_fraction=0.5)
    models = build_models(seqs.train)
    outcome = evaluate(seqs, models, [1])
    assert outcome["total"] == 1
    assert outcome["hits"]["markov-next"][1] == 1
    # The player had only launched A, so repeating own history misses B.
    assert outcome["hits"]["repeat-own-session"][1] == 0
