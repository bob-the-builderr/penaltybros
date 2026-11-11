export type Zone = 'TL' | 'TC' | 'TR' | 'BL' | 'BC' | 'BR';
export type Direction = 'left' | 'middle' | 'right';

export const ALL_ZONES: readonly Zone[] = ['TL', 'TC', 'TR', 'BL', 'BC', 'BR'] as const;

export const ZONE_LABELS: Record<Zone, string> = {
  TL: 'Top Left',
  TC: 'Top Center',
  TR: 'Top Right',
  BL: 'Bottom Left',
  BC: 'Bottom Center',
  BR: 'Bottom Right',
};

export const HIGH_CORNERS: readonly Zone[] = ['TL', 'TR'] as const;

export const ADJACENT_ZONES: Record<Zone, readonly Zone[]> = {
  TL: ['TC', 'BL'],
  TC: ['TL', 'TR', 'BC'],
  TR: ['TC', 'BR'],
  BL: ['BC', 'TL'],
  BC: ['BL', 'BR', 'TC'],
  BR: ['BC', 'TR'],
};

export function directionToZone(dir: Direction, role: PlayerRole = 'shooter'): Zone {
  if (dir === 'middle') {
    return role === 'keeper' ? 'BC' : 'TC';
  }
  if (dir === 'left') {
    return 'TL';
  }
  return 'TR';
}

export function zoneToDirection(zone: Zone): Direction {
  if (zone.endsWith('L')) return 'left';
  if (zone.endsWith('C')) return 'middle';
  return 'right';
}

export type PlayerId = 'p1' | 'p2';
export type PlayerRole = 'shooter' | 'keeper';
export type GameMode = 'ai' | 'online';
export type AIDifficulty = 'rookie' | 'pro' | 'mind_reader';

export type OutcomeType =
  | 'goal'
  | 'save'
  | 'fingertip_save'
  | 'miss_post'
  | 'miss_off_target';

export interface PlayerPick {
  zone: Zone;
  feint?: boolean;
  timedOut: boolean;
}

export interface RoundResolution {
  roundNumber: number;
  kickIndexInRound: number; // 0 = first kick of round, 1 = second kick
  shooterId: PlayerId;
  keeperId: PlayerId;
  shooterPick: PlayerPick;
  keeperPick: PlayerPick;
  outcome: OutcomeType;
  isGoal: boolean;
  shooterNerveDelta: number;
  keeperNerveDelta: number;
  shooterNerveAfter: number;
  keeperNerveAfter: number;
  isFingertip: boolean;
  missReason?: 'post' | 'off_target';
}

export interface PlayerStats {
  id: PlayerId;
  name: string;
  score: number;
  // History of kicks in standard order (up to 5, then grows in sudden death)
  kicks: (boolean | null)[];
  nerve: number; // 0 to 100
  feintsRemaining: number;
  consecutiveGoals: number;
  consecutiveSaves: number;
  // History of picks
  picksAsShooter: Zone[];
  picksAsKeeper: Zone[];
  allPicks: Zone[];
}

export interface TellState {
  tellZone: Zone;
  isHonest: boolean;
  displayedTo: PlayerId;
}

export interface MatchState {
  mode: GameMode;
  difficulty: AIDifficulty;
  p1: PlayerStats;
  p2: PlayerStats;
  kickingFirst: PlayerId;
  currentShooter: PlayerId;
  currentKeeper: PlayerId;
  currentRound: number; // 1-5 or 6+ for sudden death
  currentKickInRound: number; // 0 or 1
  isSuddenDeath: boolean;
  isMatchOver: boolean;
  winner: PlayerId | null;
  history: RoundResolution[];
  streakBanner: string | null;
}

export interface Settings {
  soundEnabled: boolean;
  volume: number; // 0 to 1
  reducedMotion: boolean;
  turnDurationSec: number; // default 4
}

export interface LifetimeStats {
  matchesPlayed: number;
  wins: number;
  losses: number;
  goalsScored: number;
  savesMade: number;
  shootoutsWon: number;
  currentStreak: number;
  bestStreak: number;
}
