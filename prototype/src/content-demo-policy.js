/** Cache-only top-three selection. Never pass this order to a player renderer. */
export function topPreparationCandidates({ catalogue, prior, session, policy = "POPULAR_UNPLAYED" }) {
  if (policy === "OFF") return [];
  const plays = new Map((session?.plays ?? []).map(play => [play.id, play]));
  const candidates = catalogue.map((entry, index) => ({ id: entry.id, index, play: plays.get(entry.id), weight: prior?.weights?.[entry.id] ?? 0 }));
  if (policy === "FAVOURITE") {
    return candidates.filter(entry => entry.play?.count > 0)
      .sort((a, b) => b.play.count - a.play.count || b.play.lastPlayedSequence - a.play.lastPlayedSequence || a.index - b.index)
      .slice(0, 3).map(entry => entry.id);
  }
  if (policy !== "POPULAR_UNPLAYED") return [];
  return candidates.filter(entry => !entry.play && Number.isFinite(entry.weight) && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index).slice(0, 3).map(entry => entry.id);
}
