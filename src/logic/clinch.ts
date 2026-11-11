import type { PlayerId } from '../types/game';

export interface ClinchCheckResult {
  isOver: boolean;
  winner: PlayerId | null;
  reason: 'clinch' | 'regular_end' | 'sudden_death_winner' | null;
}

/**
 * Checks if the match has been decided either via early clinch,
 * regular completion (5 kicks each), or sudden death.
 */
export function checkClinch(
  score1: number,
  kicks1: number,
  score2: number,
  kicks2: number,
  maxRegularKicks = 5
): ClinchCheckResult {
  const remaining1 = Math.max(0, maxRegularKicks - kicks1);
  const remaining2 = Math.max(0, maxRegularKicks - kicks2);

  // Check if both have completed regular 5 kicks
  if (kicks1 === maxRegularKicks && kicks2 === maxRegularKicks) {
    if (score1 > score2) {
      return { isOver: true, winner: 'p1', reason: 'regular_end' };
    }
    if (score2 > score1) {
      return { isOver: true, winner: 'p2', reason: 'regular_end' };
    }
    // Tied after regular 5 kicks -> Sudden death
    return { isOver: false, winner: null, reason: null };
  }

  // Early clinch check during regular rounds (one or both have kicks remaining)
  if (kicks1 <= maxRegularKicks && kicks2 <= maxRegularKicks) {
    if (score1 > score2 + remaining2) {
      return { isOver: true, winner: 'p1', reason: 'clinch' };
    }
    if (score2 > score1 + remaining1) {
      return { isOver: true, winner: 'p2', reason: 'clinch' };
    }
  }

  // Sudden Death (kicks > maxRegularKicks)
  if (kicks1 >= maxRegularKicks && kicks2 >= maxRegularKicks) {
    // Both players must have taken an EQUAL number of kicks in sudden death
    if (kicks1 === kicks2) {
      if (score1 > score2) {
        return { isOver: true, winner: 'p1', reason: 'sudden_death_winner' };
      }
      if (score2 > score1) {
        return { isOver: true, winner: 'p2', reason: 'sudden_death_winner' };
      }
    }
  }

  return { isOver: false, winner: null, reason: null };
}

/**
 * Helper determining whether a score state is decided after a certain number of total kicks.
 */
function isDecidedAfterKicks(scores: { p1: number; p2: number }, totalKicks: number): boolean {
  if (totalKicks > 10) {
    // Sudden death: decided only after equal kicks (even total kicks)
    return totalKicks % 2 === 0 && scores.p1 !== scores.p2;
  }
  const remP2 = 5 - Math.ceil(totalKicks / 2);
  const remP1 = 5 - Math.floor(totalKicks / 2);
  return scores.p2 > scores.p1 + remP2 || scores.p1 > scores.p2 + remP1;
}

/**
 * Evaluates whether the upcoming kick has high stakes:
 * - 'win': Scoring or saving clinches the victory immediately
 * - 'survive': Missing or conceding loses the match immediately
 */
export function getStakesCondition(
  role: 'shooter' | 'keeper',
  shootingPlayer: 'p1' | 'p2',
  scores: { p1: number; p2: number },
  totalKicksTaken: number
): 'win' | 'survive' | null {
  const nextKickIndex = totalKicksTaken + 1;
  const scoredScores = {
    ...scores,
    [shootingPlayer]: scores[shootingPlayer] + 1,
  };
  const ifScoredClinched = isDecidedAfterKicks(scoredScores, nextKickIndex);
  const ifMissedClinched = isDecidedAfterKicks(scores, nextKickIndex);

  if (role === 'shooter') {
    if (ifScoredClinched) return 'win';
    if (ifMissedClinched) return 'survive';
    return null;
  } else {
    // For keeper:
    // If missing clinches the match for keeper's side -> saving wins
    if (ifMissedClinched) return 'win';
    // If scoring clinches the match for shooter -> keeper must save to survive
    if (ifScoredClinched) return 'survive';
    return null;
  }
}
