import type { Settings, LifetimeStats, AIDifficulty } from '../types/game';

const SETTINGS_KEY = 'penaltybros_settings_v1';
const STATS_KEY = 'penaltybros_stats_v1';
const DIFFICULTY_KEY = 'penaltybros_difficulty_v1';

export const DEFAULT_SETTINGS: Settings = {
  soundEnabled: true,
  volume: 0.7,
  reducedMotion: false,
  turnDurationSec: 10,
};

export const DEFAULT_STATS: LifetimeStats = {
  matchesPlayed: 0,
  wins: 0,
  losses: 0,
  goalsScored: 0,
  savesMade: 0,
  shootoutsWon: 0,
  currentStreak: 0,
  bestStreak: 0,
};

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return { ...DEFAULT_SETTINGS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (err) {
    console.warn('Failed to save settings to localStorage:', err);
  }
}

export function loadDifficulty(): AIDifficulty {
  try {
    const val = localStorage.getItem(DIFFICULTY_KEY) as AIDifficulty;
    if (val === 'rookie' || val === 'pro' || val === 'mind_reader') {
      return val;
    }
    return 'pro';
  } catch {
    return 'pro';
  }
}

export function saveDifficulty(difficulty: AIDifficulty): void {
  try {
    localStorage.setItem(DIFFICULTY_KEY, difficulty);
  } catch (err) {
    console.warn('Failed to save difficulty to localStorage:', err);
  }
}

export function loadStats(): LifetimeStats {
  try {
    const raw = localStorage.getItem(STATS_KEY);
    if (!raw) return { ...DEFAULT_STATS };
    const parsed = JSON.parse(raw);
    return {
      ...DEFAULT_STATS,
      ...parsed,
    };
  } catch {
    return { ...DEFAULT_STATS };
  }
}

export function saveStats(stats: LifetimeStats): void {
  try {
    localStorage.setItem(STATS_KEY, JSON.stringify(stats));
  } catch (err) {
    console.warn('Failed to save stats to localStorage:', err);
  }
}

export function recordMatchResult(
  won: boolean,
  goalsScored: number,
  savesMade: number
): LifetimeStats {
  const stats = loadStats();
  stats.matchesPlayed += 1;
  stats.goalsScored += goalsScored;
  stats.savesMade += savesMade;

  if (won) {
    stats.wins += 1;
    stats.shootoutsWon += 1;
    stats.currentStreak += 1;
    if (stats.currentStreak > stats.bestStreak) {
      stats.bestStreak = stats.currentStreak;
    }
  } else {
    stats.losses += 1;
    stats.currentStreak = 0;
  }

  saveStats(stats);
  return stats;
}

export function resetStats(): LifetimeStats {
  const fresh = { ...DEFAULT_STATS };
  saveStats(fresh);
  return fresh;
}

