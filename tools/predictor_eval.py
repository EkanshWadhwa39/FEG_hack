#!/usr/bin/env python3
"""Offline evaluation of cache-prefetch policies on real launch sequences.

Warming is only worth doing if we warm the RIGHT game. A 99.7% byte saving on a
launch that never happens is pure waste, so the number that makes warming
defensible is the hit rate: when we prefetch K titles, how often is the game the
player actually launches next among them?

This scores several policies against the FEG-provided casino event log. It is an
OFFLINE evaluation of a CACHE policy. Its output never reaches a player-visible
surface: the drawer shows favourites, recents and search only.

Split: sessions are ordered by first launch time and split by time, so a model
is never scored on data it was built from.

Privacy: reads pseudonymised session and title fields only. Player identifiers
are never read, joined, or emitted. Output is aggregate.

Usage:
    python3 tools/predictor_eval.py --events path/to/top_casino_users_event_logs.csv
    unzip -p assets.zip assets/top_casino_users_event_logs.csv \\
        | python3 tools/predictor_eval.py --events -
"""

from __future__ import annotations

import argparse
import collections
import csv
import sys
from dataclasses import dataclass, field
from pathlib import Path

LAUNCH_EVENT = "casino_game_launch"


@dataclass
class Sequences:
    """Per-session ordered launch sequences, plus the split point."""

    train: list[list[str]] = field(default_factory=list)
    test: list[list[str]] = field(default_factory=list)

    @property
    def test_cases(self) -> int:
        # Each launch after the first in a test session is one prediction.
        return sum(max(0, len(s) - 1) for s in self.test)


def read_sequences(handle, train_fraction: float = 0.7) -> Sequences:
    """Build time-ordered per-session launch sequences from the event log."""
    per_session: dict[str, list[tuple[str, str]]] = collections.defaultdict(list)
    reader = csv.DictReader(handle)
    for row in reader:
        if row.get("event_name") != LAUNCH_EVENT:
            continue
        game = (row.get("game_name") or "").strip()
        session = (row.get("session") or "").strip()
        stamp = (row.get("timestamp") or "").strip()
        # A launch with no title or session cannot be scored either way.
        if not game or game == "null" or not session or not stamp:
            continue
        per_session[session].append((stamp, game))

    ordered = []
    for session, events in per_session.items():
        events.sort()
        ordered.append((events[0][0], [game for _, game in events]))
    ordered.sort()

    cut = int(len(ordered) * train_fraction)
    return Sequences(
        train=[seq for _, seq in ordered[:cut]],
        test=[seq for _, seq in ordered[cut:]],
    )


def build_models(train: list[list[str]]) -> dict:
    """Learn global popularity and next-title co-occurrence from training only."""
    popularity: collections.Counter[str] = collections.Counter()
    follows: dict[str, collections.Counter[str]] = collections.defaultdict(collections.Counter)
    for sequence in train:
        popularity.update(sequence)
        for current, nxt in zip(sequence, sequence[1:]):
            if current != nxt:
                follows[current][nxt] += 1
    return {"popularity": popularity, "follows": follows}


# Each policy returns up to k candidate titles to warm, given what the player
# has launched so far this session. None of them may see the future.

def policy_popular(history, models, k):
    return [title for title, _ in models["popularity"].most_common(k)]


def policy_repeat(history, models, k):
    """The player's own session history, most recent first."""
    seen = []
    for title in reversed(history):
        if title not in seen:
            seen.append(title)
    return seen[:k]


def policy_markov(history, models, k):
    """Titles that followed the current title for other players."""
    return [title for title, _ in models["follows"][history[-1]].most_common(k)]


def policy_markov_then_repeat(history, models, k):
    picks = policy_markov(history, models, k)
    for title in policy_repeat(history, models, k):
        if len(picks) >= k:
            break
        if title not in picks:
            picks.append(title)
    return picks[:k]


def policy_markov_then_popular(history, models, k):
    picks = policy_markov(history, models, k)
    for title in policy_popular(history, models, k):
        if len(picks) >= k:
            break
        if title not in picks:
            picks.append(title)
    return picks[:k]


POLICIES = {
    "popular-global": policy_popular,
    "repeat-own-session": policy_repeat,
    "markov-next": policy_markov,
    "markov+repeat": policy_markov_then_repeat,
    "markov+popular": policy_markov_then_popular,
}


def evaluate(sequences: Sequences, models: dict, k_values: list[int]) -> dict:
    results: dict[str, dict[int, int]] = {name: dict.fromkeys(k_values, 0) for name in POLICIES}
    totals = 0
    for sequence in sequences.test:
        for index in range(1, len(sequence)):
            history = sequence[:index]
            actual = sequence[index]
            totals += 1
            for name, policy in POLICIES.items():
                for k in k_values:
                    if actual in policy(history, models, k):
                        results[name][k] += 1
    return {"total": totals, "hits": results}


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--events", required=True,
                        help="event-log CSV path, or - to read stdin")
    parser.add_argument("--k", default="1,2,3,5",
                        help="comma-separated prefetch set sizes")
    parser.add_argument("--train-fraction", type=float, default=0.7)
    parser.add_argument("--asset-mb", type=float, default=11.25,
                        help="measured warm cost per title, MB (production probe)")
    args = parser.parse_args()

    k_values = [int(value) for value in args.k.split(",")]

    if args.events == "-":
        sequences = read_sequences(sys.stdin, args.train_fraction)
    else:
        with Path(args.events).open(newline="", encoding="utf-8", errors="replace") as handle:
            sequences = read_sequences(handle, args.train_fraction)

    models = build_models(sequences.train)
    outcome = evaluate(sequences, models, k_values)
    total = outcome["total"]

    print(f"train sessions: {len(sequences.train)}   test sessions: {len(sequences.test)}")
    print(f"scored predictions: {total}")
    print(f"distinct titles seen in training: {len(models['popularity'])}\n")

    header = "policy".ljust(22) + "".join(f"hit@{k}".rjust(9) for k in k_values)
    print(header)
    print("-" * len(header))
    for name in POLICIES:
        row = name.ljust(22)
        for k in k_values:
            rate = outcome["hits"][name][k] / total if total else 0
            row += f"{rate * 100:8.1f}%"
        print(row)

    print("\nCost of being wrong, at the measured 11.25 MB per warmed title:")
    best = max(POLICIES, key=lambda n: outcome["hits"][n][k_values[-1]])
    for k in k_values:
        rate = outcome["hits"][best][k] / total if total else 0
        wasted = args.asset_mb * (k - rate)
        print(f"  k={k}: best policy '{best}' hits {rate * 100:.1f}%, "
              f"warms {args.asset_mb * k:.1f} MB, ~{wasted:.1f} MB wasted per launch")


if __name__ == "__main__":
    main()
