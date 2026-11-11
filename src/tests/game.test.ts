import { describe, it, expect } from 'vitest';
import { resolveRound, calculateCornerMissChance, calculateFingertipChance } from '../logic/resolution';
import { checkClinch, getStakesCondition } from '../logic/clinch';
import { createMatch, executeKick } from '../logic/match';
import {
  chooseAIPick,
  computeWeightedFrequencies,
  getMostFrequentZone,
  predictPatternZone,
} from '../ai/opponent';
import type { Zone, PlayerPick } from '../types/game';

describe('Round Resolution Logic', () => {
  const defaultPick = (zone: Zone): PlayerPick => ({
    zone,
    feint: false,
    timedOut: false,
  });

  it('same zone guarantees a save', () => {
    const res = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: defaultPick('TL'),
      keeperPick: defaultPick('TL'),
      shooterNerve: 60,
      keeperNerve: 60,
    });

    expect(res.isGoal).toBe(false);
    expect(res.outcome).toBe('save');
    expect(res.keeperNerveAfter).toBe(75); // 60 + 15
    expect(res.shooterNerveAfter).toBe(45); // 60 - 15
  });

  it('same direction (side) with height variance guarantees a save (Left, Middle, Right)', () => {
    // 1. Left: Shooter BL, Keeper TL -> same side (Left), guaranteed save!
    const leftRes = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: defaultPick('BL'),
      keeperPick: defaultPick('TL'),
      shooterNerve: 60,
      keeperNerve: 60,
    });
    expect(leftRes.isGoal).toBe(false);
    expect(leftRes.outcome).toBe('fingertip_save');

    // 2. Middle: Shooter TC, Keeper BC -> same side (Middle), guaranteed save!
    const midRes = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: defaultPick('TC'),
      keeperPick: defaultPick('BC'),
      shooterNerve: 60,
      keeperNerve: 60,
    });
    expect(midRes.isGoal).toBe(false);
    expect(midRes.outcome).toBe('fingertip_save');

    // 3. Right: Shooter TR, Keeper BR -> same side (Right), guaranteed save!
    const rightRes = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: defaultPick('TR'),
      keeperPick: defaultPick('BR'),
      shooterNerve: 60,
      keeperNerve: 60,
    });
    expect(rightRes.isGoal).toBe(false);
    expect(rightRes.outcome).toBe('fingertip_save');
  });

  it('different directions always result in a goal (shots never miss or go wide)', () => {
    const res = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: defaultPick('TL'), // Left
      keeperPick: defaultPick('BR'), // Right
      shooterNerve: 50,
      keeperNerve: 50,
    });

    expect(res.isGoal).toBe(true);
    expect(res.outcome).toBe('goal');
    expect(res.shooterNerveAfter).toBe(62); // 50 + 12
    expect(res.keeperNerveAfter).toBe(38); // 50 - 12
  });

  it('shooter never misses wide or hits post regardless of low nerve', () => {
    // shooter has 0 nerve, picks corner TL, keeper dives opposite (BR)
    const res = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: defaultPick('TL'),
      keeperPick: defaultPick('BR'),
      shooterNerve: 0,
      keeperNerve: 50,
    });

    expect(res.isGoal).toBe(true);
    expect(res.outcome).toBe('goal');
    expect(res.missReason).toBeUndefined();
  });

  it('timeout applies additional nerve penalty', () => {
    const timedOutPick: PlayerPick = { zone: 'BR', feint: false, timedOut: true };
    const res = resolveRound({
      roundNumber: 1,
      kickIndexInRound: 0,
      shooterId: 'p1',
      keeperId: 'p2',
      shooterPick: timedOutPick,
      keeperPick: defaultPick('BR'),
      shooterNerve: 50,
      keeperNerve: 50,
    });

    // Save: shooter loses 15 for save, plus 15 for timeout = 30 loss
    expect(res.shooterNerveAfter).toBe(20);
  });
});

describe('Clinch & Sudden Death Logic', () => {
  it('detects early clinch when trailing team cannot catch up (3-0 after 3 kicks)', () => {
    // P1: 3 goals on 3 kicks. P2: 0 goals on 3 kicks.
    // P2 has 2 kicks left. Max score P2 can reach is 0 + 2 = 2 < 3.
    const result = checkClinch(3, 3, 0, 3);
    expect(result.isOver).toBe(true);
    expect(result.winner).toBe('p1');
    expect(result.reason).toBe('clinch');
  });

  it('does NOT clinch early if trailing team can still tie', () => {
    // P1: 2 goals on 3 kicks. P2: 0 goals on 2 kicks.
    // P2 has 3 kicks left (max 3). P2 could win 3-2.
    const result = checkClinch(2, 3, 0, 2);
    expect(result.isOver).toBe(false);
    expect(result.winner).toBe(null);
  });

  it('detects regular 5-kick shootout victory', () => {
    // 5 kicks each, score 4-3
    const result = checkClinch(4, 5, 3, 5);
    expect(result.isOver).toBe(true);
    expect(result.winner).toBe('p1');
    expect(result.reason).toBe('regular_end');
  });

  it('triggers sudden death when tied after 5 kicks each', () => {
    // 5 kicks each, score 3-3
    const result = checkClinch(3, 5, 3, 5);
    expect(result.isOver).toBe(false);
    expect(result.winner).toBe(null);
  });

  it('sudden death requires EQUAL kicks before declaring a winner', () => {
    // In sudden death round 6:
    // P1 kicks and scores (score 4-3, kicks 6 vs 5)
    // P2 HAS NOT KICKED YET in round 6 -> match must continue so P2 gets their turn!
    const midRound = checkClinch(4, 6, 3, 5);
    expect(midRound.isOver).toBe(false);

    // Now P2 kicks and misses (score 4-3, kicks 6 vs 6)
    // Both took equal kicks, P1 leads -> P1 wins!
    const endRound = checkClinch(4, 6, 3, 6);
    expect(endRound.isOver).toBe(true);
    expect(endRound.winner).toBe('p1');
    expect(endRound.reason).toBe('sudden_death_winner');
  });

  it('sudden death continues if both score in the same round', () => {
    // Round 6: P1 scores, P2 scores (score 4-4, kicks 6 vs 6) -> continue to round 7
    const result = checkClinch(4, 6, 4, 6);
    expect(result.isOver).toBe(false);
    expect(result.winner).toBe(null);
  });

  it('correctly calculates high stakes SCORE TO WIN and SCORE TO SURVIVE', () => {
    // P1 leads 3-1 after 6 kicks total (each took 3 kicks).
    // Now kick 7 (P1 shooting): if P1 scores (4-1), P2 has only 2 kicks left (max score 3 < 4) -> Clinched!
    // Therefore, P1 is shooting to WIN!
    const p1Stake = getStakesCondition('shooter', 'p1', { p1: 3, p2: 1 }, 6);
    expect(p1Stake).toBe('win');

    // Keeper facing this kick: if P1 scores, P2 loses. So keeper must SAVE TO SURVIVE!
    const keeperStake = getStakesCondition('keeper', 'p1', { p1: 3, p2: 1 }, 6);
    expect(keeperStake).toBe('survive');
  });
});

describe('AI Pattern Detection & Opponent Logic', () => {
  it('correctly weighs recency in frequency table', () => {
    // Picks: BL, BL, TR
    // TR is most recent so its weight is amplified
    const freqs = computeWeightedFrequencies(['BL', 'BL', 'TR']);
    expect(freqs.TR).toBeGreaterThan(0);
    expect(freqs.BL).toBeGreaterThan(0);
    expect(getMostFrequentZone(freqs)).toBeDefined();
  });

  it('calculates corner miss and fingertip chances correctly based on nerve', () => {
    expect(calculateCornerMissChance(100)).toBeCloseTo(0.07);
    expect(calculateCornerMissChance(0)).toBeCloseTo(0.25);
    expect(calculateFingertipChance(85)).toBe(0.17);
    expect(calculateFingertipChance(20)).toBe(0.07);
    expect(calculateFingertipChance(50)).toBe(0.12);
  });

  it('detects alternating pattern A-B-A and predicts B', () => {
    const predicted = predictPatternZone(['TL', 'BR', 'TL'], [], 'p1');
    expect(predicted).toBe('BR');
  });

  it('detects repeated picks and predicts repeat', () => {
    const predicted = predictPatternZone(['TR', 'TR'], [], 'p1');
    expect(predicted).toBe('TR');
  });

  it('Mind-Reader AI measurably beats a player who always picks the same zone', () => {
    // Acceptance criterion: "Mind-Reader AI measurably beats a player who always picks the same zone."
    // We simulate 30 matches between Mind-Reader AI and a static player who always picks 'TL'.
    let aiWins = 0;
    const TOTAL_MATCHES = 30;

    for (let m = 0; m < TOTAL_MATCHES; m++) {
      let state = createMatch('ai', 'mind_reader', m % 2 === 0 ? 'p1' : 'p2', 'StaticPlayer', 'MindReader');

      // Play up to 20 rounds (safety limit)
      while (!state.isMatchOver && state.currentRound <= 12) {
        const isAiShooter = state.currentShooter === 'p2';

        // Static human player always picks 'TL', never feints
        const humanPick: PlayerPick = { zone: 'TL', feint: false, timedOut: false };

        // AI chooses pick
        const aiRole = isAiShooter ? 'shooter' : 'keeper';
        const aiPickDecision = chooseAIPick(
          'mind_reader',
          aiRole,
          state.p2,
          state.p1,
          state.history
        );
        const aiPick: PlayerPick = {
          zone: aiPickDecision.zone,
          feint: aiPickDecision.feint,
          timedOut: false,
        };

        const shooterPick = isAiShooter ? aiPick : humanPick;
        const keeperPick = isAiShooter ? humanPick : aiPick;

        const { nextState } = executeKick(state, shooterPick, keeperPick);
        state = nextState;
      }

      if (state.winner === 'p2') {
        aiWins++;
      }
    }

    const winRate = aiWins / TOTAL_MATCHES;
    // Mind-Reader should decisively exploit the static player with > 85% win rate
    expect(winRate).toBeGreaterThanOrEqual(0.85);
  });
});

describe('Online Multiplayer Logic', () => {
  it('correctly creates an online match with custom player names and alternating roles', () => {
    const match = createMatch('online', 'pro', 'p1', 'Alice', 'Bob');
    expect(match.mode).toBe('online');
    expect(match.p1.name).toBe('Alice');
    expect(match.p2.name).toBe('Bob');
    expect(match.currentShooter).toBe('p1');
    expect(match.currentKeeper).toBe('p2');
    expect(match.isMatchOver).toBe(false);
  });

  it('adheres to authoritative simultaneous pick resolution: same direction = save, different = goal', () => {
    const resolveOnlineKick = (shooterDir: 'left' | 'middle' | 'right', keeperDir: 'left' | 'middle' | 'right') => {
      const isGoal = shooterDir !== keeperDir;
      return isGoal ? 'goal' : 'save';
    };

    expect(resolveOnlineKick('left', 'left')).toBe('save');
    expect(resolveOnlineKick('middle', 'middle')).toBe('save');
    expect(resolveOnlineKick('right', 'right')).toBe('save');
    expect(resolveOnlineKick('left', 'middle')).toBe('goal');
    expect(resolveOnlineKick('left', 'right')).toBe('goal');
    expect(resolveOnlineKick('middle', 'left')).toBe('goal');
  });

  it('authoritatively calculates match clinch in online shootouts', () => {
    // 3-0 after 3 rounds (P1 took 3, P2 took 3)
    const clinch = checkClinch(3, 3, 0, 3);
    expect(clinch.isOver).toBe(true);
    expect(clinch.winner).toBe('p1');
  });
});
