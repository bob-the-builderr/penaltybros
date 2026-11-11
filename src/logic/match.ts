import type {
  GameMode,
  AIDifficulty,
  PlayerId,
  PlayerStats,
  MatchState,
  PlayerPick,
  RoundResolution,
  Zone,
  TellState,
} from '../types/game';
import { ALL_ZONES } from '../types/game';
import { resolveRound } from './resolution';
import { checkClinch } from './clinch';

export function createInitialPlayer(id: PlayerId, name: string): PlayerStats {
  return {
    id,
    name,
    score: 0,
    kicks: [null, null, null, null, null],
    nerve: 60,
    feintsRemaining: 0,
    consecutiveGoals: 0,
    consecutiveSaves: 0,
    picksAsShooter: [],
    picksAsKeeper: [],
    allPicks: [],
  };
}

export function createMatch(
  mode: GameMode = 'ai',
  difficulty: AIDifficulty = 'pro',
  kickingFirst: PlayerId = 'p1',
  p1Name = 'You',
  p2Name = 'AI Rival'
): MatchState {
  const p1 = createInitialPlayer('p1', p1Name);
  const p2 = createInitialPlayer('p2', p2Name);

  return {
    mode,
    difficulty,
    p1,
    p2,
    kickingFirst,
    currentShooter: kickingFirst,
    currentKeeper: kickingFirst === 'p1' ? 'p2' : 'p1',
    currentRound: 1,
    currentKickInRound: 0,
    isSuddenDeath: false,
    isMatchOver: false,
    winner: null,
    history: [],
    streakBanner: null,
  };
}

/**
 * Generates a visual tell for the defending or shooting rival.
 * Tells are ~60% honest.
 */
export function generateTell(
  intendedZone: Zone,
  displayedTo: PlayerId,
  randomFn: () => number = Math.random
): TellState {
  // 60% chance honest tell, 40% chance false tell
  const isHonest = randomFn() < 0.6;
  if (isHonest) {
    return {
      tellZone: intendedZone,
      isHonest: true,
      displayedTo,
    };
  } else {
    const otherZones = ALL_ZONES.filter((z) => z !== intendedZone);
    const fakeZone = otherZones[Math.floor(randomFn() * otherZones.length)];
    return {
      tellZone: fakeZone,
      isHonest: false,
      displayedTo,
    };
  }
}

/**
 * Executes a completed kick resolution and updates all match state,
 * including scoreboards, nerve, streaks, and early-clinch checks.
 */
export function executeKick(
  state: MatchState,
  shooterPick: PlayerPick,
  keeperPick: PlayerPick,
  randomFn: () => number = Math.random
): { nextState: MatchState; resolution: RoundResolution } {
  if (state.isMatchOver) {
    throw new Error('Match is already over');
  }

  const shooter = state.currentShooter === 'p1' ? state.p1 : state.p2;
  const keeper = state.currentKeeper === 'p1' ? state.p1 : state.p2;

  const resolution = resolveRound({
    roundNumber: state.currentRound,
    kickIndexInRound: state.currentKickInRound,
    shooterId: state.currentShooter,
    keeperId: state.currentKeeper,
    shooterPick,
    keeperPick,
    shooterNerve: shooter.nerve,
    keeperNerve: keeper.nerve,
    randomFn,
  });

  // Clone players to maintain immutable state transitions
  const nextP1: PlayerStats = {
    ...state.p1,
    feintsRemaining: 0,
    picksAsShooter: [...state.p1.picksAsShooter],
    picksAsKeeper: [...state.p1.picksAsKeeper],
    allPicks: [...state.p1.allPicks],
    kicks: [...state.p1.kicks],
  };

  const nextP2: PlayerStats = {
    ...state.p2,
    feintsRemaining: 0,
    picksAsShooter: [...state.p2.picksAsShooter],
    picksAsKeeper: [...state.p2.picksAsKeeper],
    allPicks: [...state.p2.allPicks],
    kicks: [...state.p2.kicks],
  };

  const shooterPlayer = state.currentShooter === 'p1' ? nextP1 : nextP2;
  const keeperPlayer = state.currentKeeper === 'p1' ? nextP1 : nextP2;

  // Record picks
  shooterPlayer.picksAsShooter.push(shooterPick.zone);
  shooterPlayer.allPicks.push(shooterPick.zone);
  keeperPlayer.picksAsKeeper.push(keeperPick.zone);
  keeperPlayer.allPicks.push(keeperPick.zone);

  // Update nerve
  shooterPlayer.nerve = resolution.shooterNerveAfter;
  keeperPlayer.nerve = resolution.keeperNerveAfter;

  // Update kick tracking
  const shooterKickIndex = shooterPlayer.kicks.filter((k) => k !== null).length;
  if (shooterKickIndex < shooterPlayer.kicks.length) {
    shooterPlayer.kicks[shooterKickIndex] = resolution.isGoal;
  } else {
    // In sudden death or extended kicks
    shooterPlayer.kicks.push(resolution.isGoal);
  }

  // Update scores and streaks
  if (resolution.isGoal) {
    shooterPlayer.score += 1;
    shooterPlayer.consecutiveGoals += 1;
    keeperPlayer.consecutiveSaves = 0;
  } else {
    shooterPlayer.consecutiveGoals = 0;
    keeperPlayer.consecutiveSaves += 1;
  }

  // Calculate streak / momentum banners
  let streakBanner: string | null = null;
  if (keeperPlayer.consecutiveSaves >= 2) {
    streakBanner = `${keeperPlayer.name.toUpperCase()} ON FIRE: ${keeperPlayer.consecutiveSaves} SAVES IN A ROW!`;
  } else if (shooterPlayer.consecutiveGoals >= 3) {
    streakBanner = `${shooterPlayer.name.toUpperCase()} ICE COLD: ${shooterPlayer.consecutiveGoals} GOALS IN A ROW!`;
  }

  // Check total kicks taken by both players
  const p1KicksTaken = nextP1.kicks.filter((k) => k !== null).length;
  const p2KicksTaken = nextP2.kicks.filter((k) => k !== null).length;

  // Check early clinch or sudden death winner
  const clinch = checkClinch(nextP1.score, p1KicksTaken, nextP2.score, p2KicksTaken);

  let isMatchOver = clinch.isOver;
  let winner = clinch.winner;

  // Determine next kick and round
  let nextRound = state.currentRound;
  let nextKickInRound = state.currentKickInRound + 1;
  let nextShooter = state.currentShooter;
  let nextKeeper = state.currentKeeper;
  let isSuddenDeath = state.isSuddenDeath;

  if (nextKickInRound >= 2) {
    // Both teams have kicked in this round
    nextRound += 1;
    nextKickInRound = 0;
    if (nextRound > 5 && !isMatchOver) {
      isSuddenDeath = true;
      // If expanding into sudden death, add null slots if needed
      if (nextP1.kicks.length < nextRound) nextP1.kicks.push(null);
      if (nextP2.kicks.length < nextRound) nextP2.kicks.push(null);
    }
    // Swap back so the designated first-kicker kicks first in the new round
    nextShooter = state.kickingFirst;
    nextKeeper = state.kickingFirst === 'p1' ? 'p2' : 'p1';
  } else {
    // Second kick of the same round: swap shooter and keeper
    nextShooter = state.currentKeeper;
    nextKeeper = state.currentShooter;
  }

  const nextState: MatchState = {
    ...state,
    p1: nextP1,
    p2: nextP2,
    currentRound: nextRound,
    currentKickInRound: nextKickInRound,
    currentShooter: nextShooter,
    currentKeeper: nextKeeper,
    isSuddenDeath,
    isMatchOver,
    winner,
    history: [...state.history, resolution],
    streakBanner,
  };

  return { nextState, resolution };
}

