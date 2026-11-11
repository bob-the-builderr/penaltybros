import type {
  AIDifficulty,
  PlayerId,
  PlayerRole,
  PlayerStats,
  RoundResolution,
  Zone,
} from '../types/game';
import { ALL_ZONES, ADJACENT_ZONES } from '../types/game';

export interface AIPickDecision {
  zone: Zone;
  feint: boolean;
}

/**
 * Computes recency-weighted frequency of zones from a list of picks.
 * The most recent pick gets weight 3, previous gets 2, earlier gets 1.2, etc.
 */
export function computeWeightedFrequencies(picks: Zone[]): Record<Zone, number> {
  const freqs: Record<Zone, number> = {
    TL: 0,
    TC: 0,
    TR: 0,
    BL: 0,
    BC: 0,
    BR: 0,
  };

  const len = picks.length;
  picks.forEach((zone, idx) => {
    // Recent items get higher weight
    const recencyMultiplier = 1 + (idx / Math.max(1, len)) * 2;
    freqs[zone] += recencyMultiplier;
  });

  return freqs;
}

/**
 * Identifies the top zone by frequency, or null if empty.
 */
export function getMostFrequentZone(freqs: Record<Zone, number>): Zone {
  let bestZone: Zone = ALL_ZONES[0];
  let maxWeight = -1;

  for (const zone of ALL_ZONES) {
    if (freqs[zone] > maxWeight) {
      maxWeight = freqs[zone];
      bestZone = zone;
    }
  }

  return bestZone;
}

/**
 * Detects patterns in the player's recent sequence of picks:
 * - Direct repeats (e.g. TL, TL, ...)
 * - 2-cycle alternating (e.g. TL, BR, TL -> predicts BR)
 * - Post-save reaction (after a save, did player switch to opposite?)
 */
export function predictPatternZone(picks: Zone[], history: RoundResolution[], playerId: PlayerId): Zone | null {
  if (picks.length < 2) return null;

  const n = picks.length;
  const last = picks[n - 1];
  const secondLast = picks[n - 2];

  // Alternating 2-cycle: A, B, A -> predicts B
  if (n >= 3) {
    const thirdLast = picks[n - 3];
    if (thirdLast === last && secondLast !== last) {
      return secondLast;
    }
  }

  // 2+ Consecutive repeats: player picked the same zone twice in a row
  if (last === secondLast) {
    // Some players stick with what works, or after 2 repeats they stick to it.
    // If last 2 were identical, predict they repeat again
    return last;
  }

  // Check last round outcome for this player
  const playerHistory = history.filter(
    (h) => h.shooterId === playerId || h.keeperId === playerId
  );
  if (playerHistory.length > 0) {
    const lastResult = playerHistory[playerHistory.length - 1];
    // If player was shooter and was saved, predict they avoid the saved zone
    if (lastResult.shooterId === playerId && !lastResult.isGoal) {
      // Find opposite zone of the saved zone
      const opposite: Record<Zone, Zone> = {
        TL: 'BR',
        TC: 'BC',
        TR: 'BL',
        BL: 'TR',
        BC: 'TC',
        BR: 'TL',
      };
      return opposite[lastResult.shooterPick.zone];
    }
  }

  return null;
}

/**
 * Returns a zone that is NOT equal to the forbidden zone,
 * preferably one not even adjacent to it.
 */
export function getZoneAwayFrom(forbiddenZone: Zone, randomFn = Math.random): Zone {
  const nonAdjacent = ALL_ZONES.filter(
    (z) => z !== forbiddenZone && !ADJACENT_ZONES[forbiddenZone].includes(z)
  );
  if (nonAdjacent.length > 0) {
    return nonAdjacent[Math.floor(randomFn() * nonAdjacent.length)];
  }
  const different = ALL_ZONES.filter((z) => z !== forbiddenZone);
  return different[Math.floor(randomFn() * different.length)];
}

export function chooseAIPick(
  difficulty: AIDifficulty,
  role: PlayerRole, // AI's role: 'shooter' or 'keeper'
  _aiStats: PlayerStats,
  humanStats: PlayerStats,
  history: RoundResolution[],
  randomFn: () => number = Math.random
): AIPickDecision {
  const humanPicks =
    role === 'keeper'
      ? humanStats.picksAsShooter // AI is keeper, reading human shooter
      : humanStats.picksAsKeeper; // AI is shooter, reading human keeper

  // 1. Rookie Difficulty: Mostly random
  if (difficulty === 'rookie') {
    // 80% pure random, 20% simple repeat
    if (humanPicks.length > 0 && randomFn() < 0.2) {
      return {
        zone: humanPicks[humanPicks.length - 1],
        feint: false,
      };
    }
    const zone = ALL_ZONES[Math.floor(randomFn() * ALL_ZONES.length)];
    return { zone, feint: false };
  }

  // 2. Pro Difficulty: Frequency tracking with some randomness
  if (difficulty === 'pro') {
    const roll = randomFn();
    // 30% pure random exploration
    if (roll < 0.3 || humanPicks.length === 0) {
      const zone = ALL_ZONES[Math.floor(randomFn() * ALL_ZONES.length)];
      return { zone, feint: false };
    }

    const freqs = computeWeightedFrequencies(humanPicks);
    const mostLikelyHumanZone = getMostFrequentZone(freqs);

    if (role === 'keeper') {
      // AI Keeper wants to dive where human shoots
      if (roll < 0.75) {
        return { zone: mostLikelyHumanZone, feint: false };
      } else {
        // Pick an adjacent zone
        const adj = ADJACENT_ZONES[mostLikelyHumanZone];
        const adjacentZone = adj[Math.floor(randomFn() * adj.length)];
        return { zone: adjacentZone, feint: false };
      }
    } else {
      // AI Shooter wants to shoot AWAY from where human keeper dives
      const safeZone = getZoneAwayFrom(mostLikelyHumanZone, randomFn);
      return { zone: safeZone, feint: false };
    }
  }

  // 3. Mind-Reader Difficulty: Pattern analysis + recency counter-play
  const freqs = computeWeightedFrequencies(humanPicks);
  const patternPredictedZone = predictPatternZone(humanPicks, history, humanStats.id);
  const dominantZone = humanPicks.length > 0 ? getMostFrequentZone(freqs) : null;

  // Predict where the human is going to act
  let predictedHumanZone: Zone;
  if (patternPredictedZone && randomFn() < 0.75) {
    predictedHumanZone = patternPredictedZone;
  } else if (dominantZone && randomFn() < 0.75) {
    predictedHumanZone = dominantZone;
  } else {
    // 20-25% randomness
    predictedHumanZone = ALL_ZONES[Math.floor(randomFn() * ALL_ZONES.length)];
  }

  // Mind-Reader action based on role:
  let chosenZone: Zone;
  if (role === 'keeper') {
    // 78% dive right into predicted shooter zone, 12% adjacent, 10% surprise
    const roll = randomFn();
    if (roll < 0.78) {
      chosenZone = predictedHumanZone;
    } else if (roll < 0.90) {
      const adj = ADJACENT_ZONES[predictedHumanZone];
      chosenZone = adj[Math.floor(randomFn() * adj.length)];
    } else {
      chosenZone = ALL_ZONES[Math.floor(randomFn() * ALL_ZONES.length)];
    }
  } else {
    // AI Shooter: shoot AWAY from predicted human keeper dive
    const roll = randomFn();
    if (roll < 0.82) {
      chosenZone = getZoneAwayFrom(predictedHumanZone, randomFn);
    } else {
      // Surprise high corner shot
      const corners: Zone[] = ['TL', 'TR'];
      chosenZone = corners[Math.floor(randomFn() * corners.length)];
    }
  }

  return { zone: chosenZone, feint: false };
}

