import type {
  Zone,
  PlayerId,
  PlayerPick,
  RoundResolution,
  OutcomeType,
} from '../types/game';
import { ADJACENT_ZONES, zoneToDirection } from '../types/game';

export interface ResolveOptions {
  roundNumber: number;
  kickIndexInRound: number;
  shooterId: PlayerId;
  keeperId: PlayerId;
  shooterPick: PlayerPick;
  keeperPick: PlayerPick;
  shooterNerve: number;
  keeperNerve: number;
  // Optional deterministic random supplier (0 to 1) for tests
  randomFn?: () => number;
}

export function isAdjacentZone(z1: Zone, z2: Zone): boolean {
  return ADJACENT_ZONES[z1].includes(z2);
}

export function calculateCornerMissChance(nerve: number): number {
  const clampedNerve = Math.max(0, Math.min(100, nerve));
  // Base 7% at 100 nerve, scaling up to 25% at 0 nerve
  return 0.07 + ((100 - clampedNerve) / 100) * 0.18;
}

export function calculateFingertipChance(keeperNerve: number): number {
  const clampedNerve = Math.max(0, Math.min(100, keeperNerve));
  if (clampedNerve > 70) return 0.17;
  if (clampedNerve < 30) return 0.07;
  return 0.12;
}

export function resolveRound(opts: ResolveOptions): RoundResolution {
  const {
    roundNumber,
    kickIndexInRound,
    shooterId,
    keeperId,
    shooterPick,
    keeperPick,
    shooterNerve,
    keeperNerve,
  } = opts;

  let outcome: OutcomeType = 'goal';
  let isGoal = true;
  let isFingertip = false;
  let missReason: 'post' | 'off_target' | undefined = undefined;

  const shooterDir = zoneToDirection(shooterPick.zone);
  const keeperDir = zoneToDirection(keeperPick.zone);

  // Pure skill/nerve Penaltymen resolution:
  // 1. Same Direction (Left vs Left, Middle vs Middle, Right vs Right) -> GUARANTEED SAVE!
  // 2. Different Directions -> GUARANTEED GOAL (No RNG wide misses)!
  if (shooterDir === keeperDir) {
    isGoal = false;
    outcome = shooterPick.zone === keeperPick.zone ? 'save' : 'fingertip_save';
    isFingertip = shooterPick.zone !== keeperPick.zone;
  } else {
    isGoal = true;
    outcome = 'goal';
    isFingertip = false;
  }

  // Calculate Nerve Deltas
  // Goal: Shooter +12, Keeper -12
  // Save: Keeper +15, Shooter -15
  // Timeout penalty: -15
  let shooterDelta = 0;
  let keeperDelta = 0;

  if (isGoal) {
    shooterDelta += 12;
    keeperDelta -= 12;
  } else {
    keeperDelta += 15;
    shooterDelta -= 15;
  }

  if (shooterPick.timedOut) {
    shooterDelta -= 15;
  }
  if (keeperPick.timedOut) {
    keeperDelta -= 15;
  }

  const shooterNerveAfter = Math.max(0, Math.min(100, shooterNerve + shooterDelta));
  const keeperNerveAfter = Math.max(0, Math.min(100, keeperNerve + keeperDelta));

  return {
    roundNumber,
    kickIndexInRound,
    shooterId,
    keeperId,
    shooterPick,
    keeperPick,
    outcome,
    isGoal,
    shooterNerveDelta: shooterDelta,
    keeperNerveDelta: keeperDelta,
    shooterNerveAfter,
    keeperNerveAfter,
    isFingertip,
    missReason,
  };
}

