import { Phase, Team } from "@mimic/shared";

/** What the room should do after the player roster changes mid-match. */
export type RosterAction = "none" | "lobby" | "rebuild";

/** Minimal shape the decision needs — just each remaining player's team. */
export interface RosterMember {
  team: Team;
}

/**
 * Decide how the room should react when someone leaves during a match. Pure so
 * it can be unit-tested without spinning up a room:
 *   • "lobby"   → fewer than `minPlayers` remain; two teams can't be fielded, so
 *                 abandon to the lobby (the lone player waits for others).
 *   • "rebuild" → an active round (Prep/Hunt) where a whole side has emptied out
 *                 (all props or all hunters gone) → end early and reshuffle roles.
 *   • "none"    → nothing to do: both sides still populated, or a transient phase
 *                 (Lobby / Countdown / RoundEnd / MatchEnd) that resolves itself.
 */
export function rosterAction(phase: Phase, players: RosterMember[], minPlayers: number): RosterAction {
  if (phase === Phase.Lobby || phase === Phase.MatchEnd) return "none";
  if (players.length < minPlayers) return "lobby";
  if (phase === Phase.Countdown || phase === Phase.RoundEnd) return "none";

  const props = players.filter((p) => p.team === Team.Props).length;
  const hunters = players.filter((p) => p.team === Team.Hunters).length;
  if (props === 0 || hunters === 0) return "rebuild";
  return "none";
}
