import type {
  AIDifficulty,
  Direction,
  GameMode,
  MatchState,
  PlayerId,
  PlayerPick,
  PlayerRole,
  PlayerStats,
  Zone,
  TellState,
} from '../types/game';
import { directionToZone } from '../types/game';
import { createMatch, executeKick, generateTell } from '../logic/match';
import { getStakesCondition } from '../logic/clinch';
import { chooseAIPick } from '../ai/opponent';
import { StadiumRenderer } from '../render/stadium';
import { sound } from '../audio/sound';
import {
  loadSettings,
  saveSettings,
  loadStats,
  recordMatchResult,
  loadDifficulty,
  saveDifficulty,
} from '../storage/storage';
import { MultiplayerClient } from '../online/client';

type AppScreen = 'title' | 'match';

const STREAK_MILESTONES = [
  { wins: 3, name: 'Hat-trick' },
  { wins: 5, name: 'On fire' },
  { wins: 10, name: 'Unstoppable' },
  { wins: 20, name: 'Legend' },
];

export class PenaltyApp {
  private container: HTMLElement;
  private currentScreen: AppScreen = 'title';

  // Persistence
  private settings = loadSettings();
  private stats = loadStats();
  private selectedDifficulty: AIDifficulty = loadDifficulty();
  private selectedMode: GameMode = 'ai';
  private playerName = localStorage.getItem('penaltybros_player_name') || 'Player 1';

  // Online Multiplayer State
  private multiplayerClient: MultiplayerClient | null = null;
  private onlineModalOpen = false;
  private onlineRoomCode = '';
  private onlineWaitingForOpponent = false;
  private onlineStatusMessage = '';
  private onlineDisconnectBanner: string | null = null;
  private onlineRematchRequestedByMe = false;
  private onlineRematchRequestedByOpponent = false;

  // Match State
  private match: MatchState | null = null;
  private pendingNextState: MatchState | null = null;
  private stadium: StadiumRenderer | null = null;

  // Turn Input State
  private p1Pick: PlayerPick | null = null;
  private p2Pick: PlayerPick | null = null;
  private aiPlannedDecision: { zone: Zone; feint?: boolean } | null = null;
  private currentTell: TellState | null = null;
  private isAwaitingAction = true;

  // Turn timer
  private timerSecondsRemaining = 10;
  private timerInterval: number | null = null;

  // Modals
  private rulesModalOpen = false;
  private settingsModalOpen = false;

  constructor(container: HTMLElement) {
    this.container = container;
    this.timerSecondsRemaining = 10;
    sound.setMuted(!this.settings.soundEnabled);
    sound.setVolume(this.settings.volume);

    this.setupKeyboardListeners();
    this.checkUrlRoomParam();
    this.render();
  }

  private checkUrlRoomParam(): void {
    try {
      const urlParams = new URLSearchParams(window.location.search);
      const roomParam = urlParams.get('room');
      if (roomParam) {
        window.history.replaceState({}, document.title, window.location.pathname);
        setTimeout(() => {
          this.openOnlineModal(roomParam.toUpperCase());
        }, 120);
      }
    } catch (e) {
      console.warn('Could not parse URL room param', e);
    }
  }

  // --- Keyboard Support ---
  private setupKeyboardListeners(): void {
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'INPUT') return;

      if (e.key === 'Escape') {
        if (this.onlineModalOpen) {
          this.closeOnlineModal();
          return;
        }
        if (this.rulesModalOpen) {
          this.rulesModalOpen = false;
          this.render();
          return;
        }
        if (this.settingsModalOpen) {
          this.settingsModalOpen = false;
          this.render();
          return;
        }
      }

      if (this.currentScreen === 'match' && this.isAwaitingAction) {
        const key = e.key.toUpperCase();

        if (key === 'ARROWLEFT' || key === 'A' || key === '1') {
          e.preventDefault();
          this.handleDirectionSelect('left');
          return;
        }
        if (key === 'ARROWUP' || key === 'W' || key === '2' || e.key === ' ') {
          e.preventDefault();
          this.handleDirectionSelect('middle');
          return;
        }
        if (key === 'ARROWRIGHT' || key === 'D' || key === '3') {
          e.preventDefault();
          this.handleDirectionSelect('right');
          return;
        }
      }
    });
  }

  // --- Screen Transitions ---

  private showTitle(): void {
    this.stopTimer();
    sound.stopHeartbeat();
    this.currentScreen = 'title';
    this.match = null;
    this.pendingNextState = null;
    if (this.multiplayerClient) {
      this.multiplayerClient.disconnect();
    }
    if (this.stadium) {
      this.stadium.destroy();
      this.stadium = null;
    }
    this.render();
  }

  private startNewMatch(mode: GameMode = 'ai'): void {
    this.selectedMode = mode;

    // Coin toss deciding first kicker
    const p1KicksFirst = Math.random() < 0.5;
    const firstKicker: PlayerId = p1KicksFirst ? 'p1' : 'p2';

    this.match = createMatch('ai', this.selectedDifficulty, firstKicker, 'Player 1', 'AI Rival');

    this.currentScreen = 'match';
    this.p1Pick = null;
    this.p2Pick = null;

    // Render match shell ONCE
    this.render();
    this.initStadiumOnce();
    this.startTurn();
  }

  // --- Match Turn Logic ---

  private initStadiumOnce(): void {
    const canvas = this.container.querySelector<HTMLCanvasElement>('#matchCanvas');
    if (!canvas) return;

    if (this.stadium) {
      this.stadium.destroy();
    }
    this.stadium = new StadiumRenderer(canvas);
    this.stadium.setReducedMotion(this.settings.reducedMotion);

    // Direct canvas zone click handling
    canvas.addEventListener('click', (e) => {
      if (!this.isAwaitingAction) return;
      const rect = canvas.getBoundingClientRect();
      const clickX = e.clientX - rect.left;
      const width = rect.width;

      if (clickX < width * 0.38) {
        this.handleDirectionSelect('left');
      } else if (clickX > width * 0.62) {
        this.handleDirectionSelect('right');
      } else {
        this.handleDirectionSelect('middle');
      }
    });
  }

  private startTurn(): void {
    if (!this.match || this.match.isMatchOver) return;

    this.p1Pick = null;
    this.p2Pick = null;
    this.isAwaitingAction = true;

    // Reset turn timer to 10 seconds before HUD updates (fixes frozen/stale timer render)
    this.timerSecondsRemaining = 10;

    // Heartbeat check (sudden death only)
    if (this.match.isSuddenDeath) {
      sound.startHeartbeat(96);
    } else {
      sound.stopHeartbeat();
    }

    // Pre-kick tell & AI planned decision
    this.prepareTell();

    // Reset stadium positioning
    if (this.stadium) {
      this.stadium.resetToSpot();

      // Tell the stadium whether human is keeper (so human keeper NEVER leans/dives phantom-style)
      const isP1Shooting = this.match.currentShooter === 'p1';
      const isHumanKeeper = !isP1Shooting;
      this.stadium.setIsHumanKeeper(isHumanKeeper);

      // Player 1 = Red (#EF4444), Player 2 = Blue (#3B82F6)
      const shooterColor = isP1Shooting ? '#EF4444' : '#3B82F6';
      const keeperColor = isP1Shooting ? '#3B82F6' : '#EF4444';
      this.stadium.setPlayerColors(shooterColor, keeperColor);

      if (this.currentTell) {
        this.stadium.setTell(this.currentTell.tellZone);
      } else {
        this.stadium.setTell(null);
      }
    }

    // Update DOM UI elements in place without recreating canvas
    this.updateMatchHud();
    this.startTimer();
  }

  private prepareTell(): void {
    if (!this.match) return;

    if (this.match.mode === 'ai') {
      const aiRole: PlayerRole = this.match.currentShooter === 'p2' ? 'shooter' : 'keeper';
      const aiDecision = chooseAIPick(
        this.match.difficulty,
        aiRole,
        this.match.p2,
        this.match.p1,
        this.match.history
      );

      // Lock in the AI's intended move for this round so it does NOT re-roll when human picks!
      this.aiPlannedDecision = aiDecision;

      const tell = generateTell(aiDecision.zone, 'p1');
      this.currentTell = tell;
    } else {
      this.aiPlannedDecision = null;
      this.currentTell = null;
    }
  }

  private startTimer(): void {
    this.stopTimer();
    this.timerSecondsRemaining = 10;
    this.updateTimerDisplay(); // Render 0:10 immediately with no lag or flicker

    this.timerInterval = window.setInterval(() => {
      this.timerSecondsRemaining -= 1;
      this.updateTimerDisplay();

      if (this.timerSecondsRemaining <= 0) {
        this.stopTimer();
        this.handleTimeout();
      }
    }, 1000);
  }

  private stopTimer(): void {
    if (this.timerInterval !== null) {
      clearInterval(this.timerInterval);
      this.timerInterval = null;
    }
    const timerEl = this.container.querySelector('.sb-timer-text');
    if (timerEl) {
      timerEl.classList.remove('danger');
    }
  }

  private updateTimerDisplay(): void {
    const timerEl = this.container.querySelector<HTMLElement>('.sb-timer-text');
    if (!timerEl) return;
    const s = Math.max(0, this.timerSecondsRemaining);
    timerEl.textContent = `0:${String(s).padStart(2, '0')}`;
    const isRunning = this.timerInterval !== null;
    if (s <= 3 && isRunning) {
      timerEl.className = 'sb-timer-text danger';
    } else {
      timerEl.className = 'sb-timer-text';
    }
  }

  private handleTimeout(): void {
    sound.playBuzzer();
    const dirs: Direction[] = ['left', 'middle', 'right'];
    const randomDir = dirs[Math.floor(Math.random() * dirs.length)];
    this.executeDirection(randomDir, true);
  }

  // --- 1-CLICK INSTANT INPUT (Zero Friction) ---

  private handleDirectionSelect(dir: Direction): void {
    if (!this.isAwaitingAction) return;
    sound.playClick();
    this.executeDirection(dir, false);
  }

  private getCurrentActivePlayerId(): PlayerId {
    if (!this.match) return 'p1';
    if (this.match.mode === 'online' && this.multiplayerClient) {
      return this.multiplayerClient.yourPlayerId;
    }
    return 'p1';
  }

  private executeDirection(dir: Direction, timedOut = false): void {
    if (!this.match) return;
    this.stopTimer();
    this.isAwaitingAction = false;

    // Lock button UI state in place immediately
    this.lockControlsOnSelection(dir);

    if (this.match.mode === 'online') {
      this.multiplayerClient?.sendPick(this.match.currentRound, dir);
      this.updateOnlineTurnStatus();
      return;
    }

    const activeId = this.getCurrentActivePlayerId();
    const isHumanShooter = this.match.currentShooter === activeId;
    const activeRole: PlayerRole = isHumanShooter ? 'shooter' : 'keeper';

    // Map direction to zone based on role (keeper 'middle' maps to grounded center 'BC')
    const zone: Zone = directionToZone(dir, activeRole);
    const pick: PlayerPick = {
      zone,
      timedOut,
    };

    if (this.match.mode === 'ai') {
      this.p1Pick = pick;

      // Use the AI's committed decision generated at start of turn (NO RE-ROLLING!)
      const aiRole: PlayerRole = this.match.currentShooter === 'p2' ? 'shooter' : 'keeper';
      const aiDecision = this.aiPlannedDecision || chooseAIPick(
        this.match.difficulty,
        aiRole,
        this.match.p2,
        this.match.p1,
        this.match.history
      );

      // If AI is keeper and chose center, ground the keeper on 'BC'
      let aiZone = aiDecision.zone;
      if (aiRole === 'keeper' && aiZone === 'TC') {
        aiZone = 'BC';
      }

      this.p2Pick = {
        zone: aiZone,
        timedOut: false,
      };

      this.executeReveal();
    }
  }

  private lockControlsOnSelection(dir: Direction): void {
    const buttons = this.container.querySelectorAll<HTMLButtonElement>('.btn-direction-choice');
    buttons.forEach((b) => {
      const bDir = b.getAttribute('data-dir');
      if (bDir === dir) {
        b.classList.add('selected');
      }
      b.disabled = true;
    });
  }

  private executeReveal(): void {
    if (!this.match || !this.p1Pick || !this.p2Pick || !this.stadium) return;

    const shooterPick = this.match.currentShooter === 'p1' ? this.p1Pick : this.p2Pick;
    const keeperPick = this.match.currentKeeper === 'p1' ? this.p1Pick : this.p2Pick;

    // Calculate resolution and save nextState for when reveal completes
    const { nextState, resolution } = executeKick(
      this.match,
      shooterPick,
      keeperPick
    );

    this.pendingNextState = nextState;

    sound.playKick();

    this.stadium.startReveal({
      shooterZone: shooterPick.zone,
      keeperZone: keeperPick.zone,
      outcome: resolution.outcome,
      isFingertip: resolution.isFingertip,
      onImpact: () => {
        if (resolution.outcome === 'goal') {
          sound.playNet();
          sound.playGoalCheer();
        } else if (resolution.outcome === 'save' || resolution.outcome === 'fingertip_save') {
          sound.playSave(resolution.isFingertip);
          sound.playGroan();
        } else if (resolution.outcome === 'miss_post') {
          sound.playPost();
          sound.playGroan();
        } else {
          sound.playGroan();
        }

        // Show horizontal strip banner in place without wiping DOM
        this.showRevealStripBanner(resolution.isGoal);
      },
      onComplete: () => {
        setTimeout(() => {
          this.hideRevealStripBanner();
          if (this.pendingNextState) {
            this.match = this.pendingNextState;
            this.pendingNextState = null;
          }
          this.checkMatchEndOrContinue();
        }, 1100);
      },
    });
  }

  private showRevealStripBanner(isGoal: boolean): void {
    const strip = this.container.querySelector<HTMLElement>('.penmen-reveal-strip');
    const text = this.container.querySelector<HTMLElement>('.reveal-strip-text');
    if (!strip || !text) return;

    text.textContent = isGoal ? 'GOAL' : 'SAVED';
    text.className = `reveal-strip-text ${isGoal ? 'goal' : 'saved'}`;
    strip.style.display = 'flex';
  }

  private hideRevealStripBanner(): void {
    const strip = this.container.querySelector<HTMLElement>('.penmen-reveal-strip');
    if (strip) strip.style.display = 'none';
  }

  private checkMatchEndOrContinue(): void {
    if (!this.match) return;

    if (this.match.isMatchOver) {
      sound.stopHeartbeat();
      sound.playWhistle();

      if (this.match.mode === 'ai') {
        const won = this.match.winner === 'p1';
        this.stats = recordMatchResult(
          won,
          this.match.p1.score,
          this.match.p1.picksAsKeeper.length - this.match.p2.score
        );
      }

      this.renderGameOverModal();
    } else {
      this.startTurn();
    }
  }

  // --- ONLINE MULTIPLAYER HANDLING ---

  private ensureMultiplayerClient(): MultiplayerClient {
    if (!this.multiplayerClient) {
      this.multiplayerClient = new MultiplayerClient({
        onConnectionChange: (connected) => {
          if (!connected && this.match?.mode === 'online' && this.currentScreen === 'match') {
            this.onlineStatusMessage = 'Disconnected from server.';
            this.updateOnlineTurnStatus();
          }
        },
        onRoomState: (state) => {
          this.onlineWaitingForOpponent = state.waitingForOpponent;
          this.onlineStatusMessage = state.waitingForOpponent
            ? 'Waiting for rival to connect...'
            : 'Rival connected! Preparing match...';
          this.updateOnlineModal();
        },
        onMatchStart: (data) => {
          this.onlineModalOpen = false;
          this.onlineRematchRequestedByMe = false;
          this.onlineRematchRequestedByOpponent = false;
          this.onlineDisconnectBanner = null;
          this.selectedMode = 'online';
          this.currentScreen = 'match';

          this.match = createMatch('online', 'pro', data.firstKicker, data.p1Name, data.p2Name);

          const existingGameOver = this.container.querySelector('.game-over-modal-backdrop');
          if (existingGameOver) existingGameOver.remove();

          this.render();
          this.initStadiumOnce();

          const isP1Shooting = data.firstKicker === 'p1';
          this.stadium?.setPlayerColors(
            isP1Shooting ? '#EF4444' : '#3B82F6',
            isP1Shooting ? '#3B82F6' : '#EF4444'
          );
          this.stadium?.setIsHumanKeeper(data.firstKicker !== data.yourPlayerId);
        },
        onRoundStart: (data) => {
          if (!this.match) return;
          this.match.currentRound = data.roundNumber;
          this.match.currentShooter = data.currentShooter;
          this.match.currentKeeper = data.currentShooter === 'p1' ? 'p2' : 'p1';
          this.isAwaitingAction = true;
          this.p1Pick = null;
          this.p2Pick = null;

          if (this.match.isSuddenDeath) {
            sound.startHeartbeat(96);
          } else {
            sound.stopHeartbeat();
          }

          if (this.stadium) {
            this.stadium.resetToSpot();
            const isP1Shooting = data.currentShooter === 'p1';
            this.stadium.setPlayerColors(
              isP1Shooting ? '#EF4444' : '#3B82F6',
              isP1Shooting ? '#3B82F6' : '#EF4444'
            );
            const isLocalKeeper = data.currentShooter !== this.multiplayerClient?.yourPlayerId;
            this.stadium.setIsHumanKeeper(isLocalKeeper);
            this.stadium.setTell(null);
          }

          this.updateMatchHud();
          this.startTimer();
          this.updateOnlineTurnStatus();
        },
        onOpponentLocked: () => {
          // No banner shown to keep the match HUD clean
        },
        onRoundResult: (data) => {
          this.handleOnlineRoundResult(data);
        },
        onRematchRequested: (requestedBy) => {
          if (requestedBy !== this.multiplayerClient?.yourPlayerId) {
            this.onlineRematchRequestedByOpponent = true;
            this.updateRematchModalUi();
          }
        },
        onOpponentDisconnected: () => {
          this.onlineDisconnectBanner = '⚠️ Opponent disconnected. Waiting 15s...';
          this.updateOnlineTurnStatus();
        },
        onOpponentReconnected: () => {
          this.onlineDisconnectBanner = null;
          this.updateOnlineTurnStatus();
        },
        onOpponentForfeit: (winner, reason) => {
          if (this.match) {
            this.match.isMatchOver = true;
            this.match.winner = winner;
            this.renderGameOverModal(reason);
          }
        },
        onError: (message) => {
          this.onlineStatusMessage = message;
          this.updateOnlineModal();
        },
      });
    }
    return this.multiplayerClient;
  }

  private updateOnlineTurnStatus(): void {
    if (this.match?.mode !== 'online') return;
    const container = this.container.querySelector<HTMLElement>('.online-turn-status-container');
    const textEl = this.container.querySelector<HTMLElement>('.online-turn-status-text');
    if (!container || !textEl) return;

    if (this.onlineDisconnectBanner) {
      textEl.textContent = this.onlineDisconnectBanner;
      textEl.className = 'online-turn-status-text danger';
      container.style.display = 'flex';
      return;
    }

    textEl.textContent = '';
    textEl.className = 'online-turn-status-text';
    container.style.display = 'none';
  }

  private handleOnlineRoundResult(data: {
    roundNumber: number;
    shooterDir: Direction;
    keeperDir: Direction;
    outcome: 'goal' | 'save';
    p1Score: number;
    p2Score: number;
    p1Kicks: (boolean | null)[];
    p2Kicks: (boolean | null)[];
    isOver: boolean;
    winner: PlayerId | null;
    clinchReason?: string;
  }): void {
    if (!this.match || !this.stadium) return;
    this.stopTimer();
    this.isAwaitingAction = false;
    this.updateOnlineTurnStatus();

    const shooterZone = directionToZone(data.shooterDir, 'shooter');
    const keeperZone = directionToZone(data.keeperDir, 'keeper');

    sound.playKick();

    this.stadium.startReveal({
      shooterZone,
      keeperZone,
      outcome: data.outcome,
      isFingertip: false,
      onImpact: () => {
        if (data.outcome === 'goal') {
          sound.playNet();
          sound.playGoalCheer();
        } else {
          sound.playSave(false);
          sound.playGroan();
        }
        this.showRevealStripBanner(data.outcome === 'goal');
      },
      onComplete: () => {
        setTimeout(() => {
          this.hideRevealStripBanner();
          if (!this.match) return;

          this.match.p1.score = data.p1Score;
          this.match.p2.score = data.p2Score;
          this.match.p1.kicks = [...data.p1Kicks];
          this.match.p2.kicks = [...data.p2Kicks];
          this.updateMatchHud();

          if (data.isOver) {
            this.match.isMatchOver = true;
            this.match.winner = data.winner;
            sound.stopHeartbeat();
            sound.playWhistle();
            this.renderGameOverModal(data.clinchReason);
          }
        }, 1100);
      },
    });
  }

  // --- Dynamic DOM Updating (Preserves Canvas & 60fps Loop) ---

  private updateMatchHud(): void {
    if (!this.match) return;

    const p1 = this.match.p1;
    const p2 = this.match.p2;
    const activePlayerId = this.getCurrentActivePlayerId();
    const isP1Shooting = this.match.currentShooter === 'p1';
    const youRole: PlayerRole = this.match.currentShooter === activePlayerId ? 'shooter' : 'keeper';

    // Update Round Title
    const roundTitleEl = this.container.querySelector('.sb-round-text');
    if (roundTitleEl) {
      roundTitleEl.textContent = `${this.match.isSuddenDeath ? 'SUDDEN DEATH' : 'PENALTIES'} · ROUND ${this.match.currentRound}`;
    }

    // Update Timer Text
    this.updateTimerDisplay();

    // Update Scores
    const p1ScoreEl = this.container.querySelector('.sb-score-number.p1');
    const p2ScoreEl = this.container.querySelector('.sb-score-number.p2');
    if (p1ScoreEl) p1ScoreEl.textContent = p1.score.toString();
    if (p2ScoreEl) p2ScoreEl.textContent = p2.score.toString();

    // Update Role Tags
    const p1RoleEl = this.container.querySelector('.sb-role-tag.p1');
    const p2RoleEl = this.container.querySelector('.sb-role-tag.p2');
    if (p1RoleEl) p1RoleEl.textContent = `(${isP1Shooting ? 'SHOOTER' : 'KEEPER'})`;
    if (p2RoleEl) p2RoleEl.textContent = `(${!isP1Shooting ? 'SHOOTER' : 'KEEPER'})`;

    // Update Dots
    const p1DotsEl = this.container.querySelector('.sb-shots-dots.p1');
    const p2DotsEl = this.container.querySelector('.sb-shots-dots.p2');
    if (p1DotsEl) p1DotsEl.innerHTML = this.buildDotsHtml(p1);
    if (p2DotsEl) p2DotsEl.innerHTML = this.buildDotsHtml(p2);

    // Update High Stakes Floating Banner
    const totalKicksTaken =
      p1.kicks.filter((x) => x !== null).length +
      p2.kicks.filter((x) => x !== null).length;

    const stake = getStakesCondition(
      youRole,
      this.match.currentShooter,
      { p1: p1.score, p2: p2.score },
      totalKicksTaken
    );

    const stakesBannerEl = this.container.querySelector<HTMLElement>('.stakes-floating-banner');
    if (stakesBannerEl) {
      if (stake) {
        let text = '';
        if (stake === 'win') {
          text = youRole === 'shooter' ? 'SCORE TO WIN' : 'SAVE TO WIN';
        } else {
          text = youRole === 'shooter' ? 'SCORE TO SURVIVE' : 'SAVE TO SURVIVE';
        }
        stakesBannerEl.textContent = text;
        stakesBannerEl.className = `stakes-floating-banner ${stake === 'win' ? 'win' : 'survive'}`;
        stakesBannerEl.style.display = 'block';
      } else {
        stakesBannerEl.style.display = 'none';
      }
    }

    // Update Direction Buttons text & state
    const dirLabels = {
      shooter: { left: 'Left', middle: 'Center', right: 'Right' },
      keeper: { left: 'Dive left', middle: 'Stay', right: 'Dive right' },
    };
    const currentLabels = dirLabels[youRole];
    const isRedTeam = activePlayerId === 'p1';

    const btnLeft = this.container.querySelector<HTMLButtonElement>('.btn-direction-choice[data-dir="left"]');
    const btnMiddle = this.container.querySelector<HTMLButtonElement>('.btn-direction-choice[data-dir="middle"]');
    const btnRight = this.container.querySelector<HTMLButtonElement>('.btn-direction-choice[data-dir="right"]');

    if (btnLeft && btnMiddle && btnRight) {
      btnLeft.querySelector('span')!.textContent = currentLabels.left;
      btnMiddle.querySelector('span')!.textContent = currentLabels.middle;
      btnRight.querySelector('span')!.textContent = currentLabels.right;

      [btnLeft, btnMiddle, btnRight].forEach((b) => {
        b.disabled = false;
        b.classList.remove('selected');
        if (isRedTeam) {
          b.classList.remove('p2-color');
        } else {
          b.classList.add('p2-color');
        }
      });
    }
  }

  private buildDotsHtml(player: PlayerStats): string {
    const regularCount = Math.max(5, this.match!.currentRound);
    const dots: string[] = [];

    for (let i = 0; i < regularCount; i++) {
      const val = player.kicks[i];
      const isCurrent =
        this.match!.currentShooter === player.id &&
        i === player.kicks.filter((x) => x !== null).length;

      if (val === true) {
        dots.push(`
          <span class="shot-dot scored" role="img" aria-label="Scored">
            <svg style="width:10px; height:10px;" viewBox="0 0 24 24" fill="none" stroke="#0B1220" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
              <path d="M5 12l5 5L19 7" />
            </svg>
          </span>
        `);
      } else if (val === false) {
        dots.push(`
          <span class="shot-dot missed" role="img" aria-label="Missed">
            <svg style="width:9px; height:9px;" viewBox="0 0 24 24" fill="none" stroke="#0B1220" stroke-width="4" stroke-linecap="round">
              <path d="M6 6l12 12M18 6L6 18" />
            </svg>
          </span>
        `);
      } else if (isCurrent) {
        dots.push(`<span class="shot-dot current" aria-label="Kicking now"></span>`);
      } else {
        dots.push(`<span class="shot-dot open" aria-label="Pending"></span>`);
      }
    }
    return dots.join('');
  }

  // --- Rendering UI Tree ---

  public render(): void {
    this.container.innerHTML = '';

    if (this.currentScreen === 'title') {
      this.renderTitleScreen();
    } else if (this.currentScreen === 'match') {
      this.renderMatchScreen();
    }

    if (this.onlineModalOpen) {
      this.renderOnlineModal();
    }
    if (this.rulesModalOpen) {
      this.renderRulesModal();
    }
    if (this.settingsModalOpen) {
      this.renderSettingsModal();
    }
  }

  private renderTitleScreen(): void {
    const el = document.createElement('div');
    el.className = 'screen screen-title';

    const currentStreak = this.stats.currentStreak;
    const nextMilestone = STREAK_MILESTONES.find((m) => m.wins > currentStreak);

    el.innerHTML = `
      <div class="title-top-bar">
        <button class="btn-header-icon" id="btnToggleSound" aria-label="Toggle Sound">
          ${this.settings.soundEnabled ? '🔊' : '🔇'}
        </button>
        <div style="display:flex; gap:8px;">
          <button class="btn-header-icon" id="btnOpenRules" aria-label="Rules">📖</button>
          <button class="btn-header-icon" id="btnOpenSettings" aria-label="Settings">⚙️</button>
        </div>
      </div>

      <div class="title-center-hero">
        <svg class="hero-soccer-ball" viewBox="0 0 64 64">
          <circle cx="32" cy="32" r="30" fill="#0B1220"/>
          <circle cx="32" cy="32" r="26" fill="#F8FAFC"/>
          <polygon points="32,20 38,24 36,31 28,31 26,24" fill="#0F172A"/>
          <polygon points="32,8 36,12 34,16 30,16 28,12" fill="#0F172A"/>
          <polygon points="46,18 50,22 47,26 43,24 43,19" fill="#0F172A"/>
          <polygon points="18,18 21,19 21,24 17,26 14,22" fill="#0F172A"/>
          <polygon points="44,38 48,34 52,36 50,42 45,42" fill="#0F172A"/>
          <polygon points="20,38 19,42 14,42 12,36 16,34" fill="#0F172A"/>
          <circle cx="32" cy="32" r="26" fill="none" stroke="#F5C451" stroke-width="2.5"/>
        </svg>

        <h1 class="title-big-heading">PENALTY<br><span>BROS</span></h1>
        <p class="title-subtitle">Pick a corner. Read your rival.</p>

        ${
          currentStreak > 0
            ? `<div class="streak-pill-badge">
                <span>🔥 <strong>${currentStreak}-win streak</strong></span>
                ${nextMilestone ? `<span style="color:var(--muted)">· ${nextMilestone.wins - currentStreak} more for ${nextMilestone.name}</span>` : ''}
              </div>`
            : ''
        }

        <div class="difficulty-selector-box">
          <div class="diff-label">AI Difficulty</div>
          <div class="diff-buttons-grid">
            <button class="diff-btn ${this.selectedDifficulty === 'rookie' ? 'active' : ''}" data-diff="rookie">Rookie</button>
            <button class="diff-btn ${this.selectedDifficulty === 'pro' ? 'active' : ''}" data-diff="pro">Pro</button>
            <button class="diff-btn ${this.selectedDifficulty === 'mind_reader' ? 'active' : ''}" data-diff="mind_reader">Mind-Reader</button>
          </div>
        </div>

        <div class="title-menu-actions">
          <button class="btn-play-primary" id="btnPlayOnline">
            <span>🌐 ONLINE 1v1</span>
          </button>
          <button class="btn-play-secondary" id="btnPlayAI">
            <span>⚽ PLAY VS AI</span>
          </button>
        </div>
      </div>

      <div style="font-size:0.75rem; color:var(--muted); text-align:center; padding-bottom:6px;">
        Lifetime: ${this.stats.wins}W - ${this.stats.losses}L · Best Streak: ${this.stats.bestStreak} 🔥
      </div>
    `;

    this.container.appendChild(el);

    // Bindings
    el.querySelector('#btnPlayOnline')?.addEventListener('click', () => {
      sound.playClick();
      this.openOnlineModal();
    });

    el.querySelector('#btnPlayAI')?.addEventListener('click', () => {
      sound.playClick();
      this.startNewMatch('ai');
    });

    el.querySelector('#btnToggleSound')?.addEventListener('click', () => {
      this.settings.soundEnabled = !this.settings.soundEnabled;
      sound.setMuted(!this.settings.soundEnabled);
      saveSettings(this.settings);
      this.render();
    });

    el.querySelector('#btnOpenRules')?.addEventListener('click', () => {
      sound.playClick();
      this.rulesModalOpen = true;
      this.render();
    });

    el.querySelector('#btnOpenSettings')?.addEventListener('click', () => {
      sound.playClick();
      this.settingsModalOpen = true;
      this.render();
    });

    el.querySelectorAll('.diff-btn').forEach((b) => {
      b.addEventListener('click', () => {
        sound.playClick();
        const diff = b.getAttribute('data-diff') as AIDifficulty;
        this.selectedDifficulty = diff;
        saveDifficulty(diff);
        this.render();
      });
    });
  }

  private renderMatchScreen(): void {
    if (!this.match) return;

    const el = document.createElement('div');
    el.className = 'screen screen-match';

    const p1 = this.match.p1;
    const p2 = this.match.p2;

    const arrowLeft = 'M17 17L7 7M7 17V7h10'; // ↖
    const arrowUp = 'M12 19V5M5 12l7-7 7 7'; // ↑
    const arrowRight = 'M7 17L17 7M7 7h10v10'; // ↗

    el.innerHTML = `
      <div class="match-inner-container">
        <!-- HEADER BAR (Penaltymen style) -->
        <header class="match-header-bar">
          <button class="btn-header-icon" id="btnMatchMute" aria-label="${this.settings.soundEnabled ? 'Mute' : 'Unmute'}">
            <svg style="width:20px; height:20px;" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5L6 9H3v6h3l5 4V5z"/>
              ${
                this.settings.soundEnabled
                  ? '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'
                  : '<path d="M22 9l-6 6M16 9l6 6"/>'
              }
            </svg>
          </button>
          <span class="match-header-title">PENALTY BROS</span>
          <span class="match-mode-pill">
            ${
              this.match.mode === 'ai'
                ? `AI · ${this.selectedDifficulty.toUpperCase()}`
                : `ONLINE · ROOM ${this.multiplayerClient?.getRoomCode() || ''}`
            }
          </span>
        </header>

        <!-- SCOREBOARD (Penaltymen bO component) -->
        <div class="penmen-scoreboard">
          <div class="sb-top-header">
            <span class="sb-round-text">
              PENALTIES · ROUND 1
            </span>
            <span class="sb-timer-text">
              0:10
            </span>
          </div>

          <!-- P1 Row -->
          <div class="sb-player-row">
            <span class="sb-team-bar p1"></span>
            <div class="sb-player-name-area">
              <span class="sb-name-text">${p1.name}</span>
              ${
                this.match.mode === 'ai' ||
                (this.match.mode === 'online' && this.multiplayerClient?.yourPlayerId === 'p1')
                  ? '<span class="sb-you-tag">YOU</span>'
                  : ''
              }
              <span class="sb-role-tag p1">(${this.match.currentShooter === 'p1' ? 'SHOOTER' : 'KEEPER'})</span>
            </div>
            <div class="sb-shots-dots p1">${this.buildDotsHtml(p1)}</div>
            <span class="sb-score-number p1">${p1.score}</span>
          </div>

          <!-- P2 Row -->
          <div class="sb-player-row second">
            <span class="sb-team-bar p2"></span>
            <div class="sb-player-name-area">
              <span class="sb-name-text">${p2.name}</span>
              ${
                this.match.mode === 'online' && this.multiplayerClient?.yourPlayerId === 'p2'
                  ? '<span class="sb-you-tag">YOU</span>'
                  : ''
              }
              <span class="sb-role-tag p2">(${this.match.currentShooter === 'p2' ? 'SHOOTER' : 'KEEPER'})</span>
            </div>
            <div class="sb-shots-dots p2">${this.buildDotsHtml(p2)}</div>
            <span class="sb-score-number p2">${p2.score}</span>
          </div>
        </div>

        <!-- STADIUM STAGE -->
        <div class="match-canvas-stage">
          <canvas id="matchCanvas" class="stage-canvas"></canvas>

          <!-- Floating High Stakes Banner -->
          <div class="stakes-floating-banner" style="display:none;"></div>

          <!-- Reveal Banner Strip (Horizontal SAVED / GOAL) -->
          <div class="penmen-reveal-strip" style="display:none;">
            <span class="reveal-strip-text goal">GOAL</span>
          </div>
        </div>

        <!-- Online Disconnect Alert Indicator (only shown if disconnected) -->
        <div class="online-turn-status-container" style="display:none;">
          <span class="online-turn-status-text"></span>
        </div>

        <!-- 3-WAY DIRECTION BUTTONS (Pq from Penaltymen) -->
        <div class="penmen-direction-picker">
          <button
            type="button"
            class="btn-direction-choice"
            data-dir="left">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="${arrowLeft}" />
            </svg>
            <span>Left</span>
          </button>

          <button
            type="button"
            class="btn-direction-choice"
            data-dir="middle">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="${arrowUp}" />
            </svg>
            <span>Center</span>
          </button>

          <button
            type="button"
            class="btn-direction-choice"
            data-dir="right">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="${arrowRight}" />
            </svg>
            <span>Right</span>
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(el);

    // Event Bindings
    el.querySelector('#btnMatchMute')?.addEventListener('click', () => {
      this.settings.soundEnabled = !this.settings.soundEnabled;
      sound.setMuted(!this.settings.soundEnabled);
      saveSettings(this.settings);
      const icon = el.querySelector('#btnMatchMute svg');
      if (icon) {
        icon.innerHTML = `
          <path d="M11 5L6 9H3v6h3l5 4V5z"/>
          ${
            this.settings.soundEnabled
              ? '<path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13"/>'
              : '<path d="M22 9l-6 6M16 9l6 6"/>'
          }
        `;
      }
    });

    el.querySelectorAll('.btn-direction-choice').forEach((b) => {
      b.addEventListener('click', () => {
        const dir = b.getAttribute('data-dir') as Direction;
        this.handleDirectionSelect(dir);
      });
    });
  }

  // --- GAME OVER MODAL (Penaltymen BB component) ---

  private renderGameOverModal(customReason?: string): void {
    if (!this.match) return;

    // Remove existing if any
    const existing = this.container.querySelector('.game-over-modal-backdrop');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.className = 'game-over-modal-backdrop';

    const p1 = this.match.p1;
    const isWinnerP1 = this.match.winner === 'p1';
    const isAi = this.match.mode === 'ai';
    const isOnline = this.match.mode === 'online';

    let playerWon = false;
    let title = '';
    let subtitle = '';

    if (isAi) {
      playerWon = isWinnerP1;
      title = isWinnerP1 ? 'YOU WIN' : 'YOU LOSE';
      subtitle = isWinnerP1 ? 'You read them well.' : 'Not this time.';
    } else if (isOnline) {
      const myId = this.multiplayerClient?.yourPlayerId || 'p1';
      playerWon = this.match.winner === myId;
      title = playerWon ? 'YOU WIN' : 'YOU LOSE';
      subtitle = customReason || (playerWon ? 'Flawless mind games.' : 'Out-guessed this time.');
    } else {
      playerWon = true;
      title = `${this.match.winner === 'p1' ? p1.name : this.match.p2.name} WINS`;
      subtitle = 'Great penalty shootout!';
    }

    let confettiHtml = '';
    if (playerWon) {
      const colors = ['#F5C451', '#3B82F6', '#EF4444', '#FFFFFF'];
      confettiHtml = Array.from({ length: 40 }, (_, i) => {
        const left = Math.random() * 100;
        const color = colors[i % colors.length];
        const duration = 2.2 + Math.random() * 1.2;
        const drift = (Math.random() - 0.5) * 160;
        const spin = (Math.random() - 0.5) * 1080;
        return `<span class="confetti-piece" style="left:${left}%; width:8px; height:12px; background:${color}; animation-duration:${duration}s; --drift:${drift}px; --spin:${spin}deg;"></span>`;
      }).join('');
    }

    modal.innerHTML = `
      ${confettiHtml}
      <div class="game-over-card ${playerWon ? 'winner' : ''}">
        <div class="go-fulltime-label">FULL TIME</div>
        <h2 class="go-headline ${playerWon ? 'win' : 'lose'}">${title}</h2>
        <p class="go-subtext">${subtitle}</p>

        <!-- Final Score Display -->
        <div style="display:flex; justify-content:center; align-items:center; gap:20px; margin:18px 0; font-family:var(--font-display); font-size:3.5rem; font-weight:800;">
          <span style="color:${isWinnerP1 ? 'var(--gold)' : 'var(--ink)'}">${p1.score}</span>
          <span style="color:var(--muted); font-size:2.2rem;">–</span>
          <span style="color:${!isWinnerP1 ? 'var(--gold)' : 'var(--ink)'}">${this.match.p2.score}</span>
        </div>

        ${
          this.stats.currentStreak > 0
            ? `<div class="streak-pill-badge" style="margin: 0 auto 16px auto;">
                <span>🔥 <strong>${this.stats.currentStreak}-win streak</strong></span>
              </div>`
            : ''
        }

        <div class="go-actions-stack">
          <button class="btn-play-again-big" id="btnPlayAgain">
            ${
              isOnline
                ? this.onlineRematchRequestedByMe
                  ? 'REMATCH REQUESTED (1/2)...'
                  : this.onlineRematchRequestedByOpponent
                  ? 'ACCEPT REMATCH (1/2)'
                  : 'REMATCH'
                : 'PLAY AGAIN'
            }
          </button>
          <button class="btn-home-link" id="btnGoHome">
            HOME
          </button>
        </div>
      </div>
    `;

    this.container.appendChild(modal);

    modal.querySelector('#btnPlayAgain')?.addEventListener('click', () => {
      sound.playClick();
      if (isOnline) {
        if (!this.onlineRematchRequestedByMe) {
          this.onlineRematchRequestedByMe = true;
          this.multiplayerClient?.requestRematch();
          const btn = modal.querySelector<HTMLButtonElement>('#btnPlayAgain');
          if (btn) {
            btn.textContent = 'REMATCH REQUESTED (1/2)...';
            btn.disabled = true;
          }
        }
      } else {
        modal.remove();
        this.startNewMatch(this.selectedMode);
      }
    });

    modal.querySelector('#btnGoHome')?.addEventListener('click', () => {
      sound.playClick();
      modal.remove();
      this.showTitle();
    });
  }

  private updateRematchModalUi(): void {
    const btn = this.container.querySelector<HTMLButtonElement>('#btnPlayAgain');
    if (!btn || this.match?.mode !== 'online') return;

    if (this.onlineRematchRequestedByMe) {
      btn.textContent = 'REMATCH REQUESTED (1/2)...';
      btn.disabled = true;
    } else if (this.onlineRematchRequestedByOpponent) {
      btn.textContent = 'ACCEPT REMATCH (1/2)';
      btn.disabled = false;
    }
  }

  // --- Modals ---

  private renderRulesModal(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'game-over-modal-backdrop';

    backdrop.innerHTML = `
      <div class="game-over-card" style="text-align:left; max-width:480px; max-height:85vh; overflow-y:auto;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">
          <h2 style="font-family:var(--font-display); font-size:1.8rem; color:var(--gold);">HOW TO PLAY</h2>
          <button class="btn-header-icon" id="btnCloseRules">✕</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:14px; font-size:0.9rem; line-height:1.45; color:#CBD5E1;">
          <div>
            <strong style="color:var(--gold);">1. Pick a Corner. Read Your Rival.</strong>
            <p>Select <strong>LEFT</strong>, <strong>CENTER</strong>, or <strong>RIGHT</strong> with a single tap (or Arrow keys / 1-2-3 / A-W-D).</p>
          </div>
          <div>
            <strong style="color:var(--team-blue);">2. Shoot &amp; Save</strong>
            <p>If the keeper dives the same way as the shot, it's <strong>SAVED</strong>! If they guess wrong, it's a <strong>GOAL</strong>!</p>
          </div>
          <div>
            <strong style="color:var(--gold);">3. Mind Games &amp; Tells</strong>
            <p>Watch the rival's stance before the kick: they lean towards their intended target (~60% honest).</p>
          </div>
          <div>
            <strong style="color:var(--missed);">4. High Stakes</strong>
            <p>When the shootout reaches a match point, feel the pressure: <strong>SCORE TO WIN</strong> or <strong>SAVE TO SURVIVE</strong>!</p>
          </div>
        </div>

        <button class="btn-play-again-big" id="btnRulesOk" style="width:100%; margin-top:20px;">
          LET'S PLAY
        </button>
      </div>
    `;

    this.container.appendChild(backdrop);

    const close = () => {
      sound.playClick();
      this.rulesModalOpen = false;
      this.render();
    };

    backdrop.querySelector('#btnCloseRules')?.addEventListener('click', close);
    backdrop.querySelector('#btnRulesOk')?.addEventListener('click', close);
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  private renderSettingsModal(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'game-over-modal-backdrop';

    backdrop.innerHTML = `
      <div class="game-over-card" style="text-align:left; max-width:440px;">
        <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:16px;">
          <h2 style="font-family:var(--font-display); font-size:1.8rem; color:var(--gold);">SETTINGS</h2>
          <button class="btn-header-icon" id="btnCloseSettings">✕</button>
        </div>

        <div style="display:flex; flex-direction:column; gap:16px; font-size:0.95rem;">
          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Sound Effects</span>
            <button class="btn-play-secondary" id="btnToggleSoundSetting" style="height:36px; padding:0 16px; font-size:0.9rem;">
              ${this.settings.soundEnabled ? 'ENABLED' : 'MUTED'}
            </button>
          </div>

          <div style="display:flex; justify-content:space-between; align-items:center;">
            <span>Reduced Motion</span>
            <button class="btn-play-secondary" id="btnToggleMotionSetting" style="height:36px; padding:0 16px; font-size:0.9rem;">
              ${this.settings.reducedMotion ? 'ON' : 'OFF'}
            </button>
          </div>
        </div>

        <button class="btn-play-again-big" id="btnSaveSettings" style="width:100%; margin-top:24px;">
          DONE
        </button>
      </div>
    `;

    this.container.appendChild(backdrop);

    const close = () => {
      sound.playClick();
      this.settingsModalOpen = false;
      this.render();
    };

    backdrop.querySelector('#btnCloseSettings')?.addEventListener('click', close);
    backdrop.querySelector('#btnSaveSettings')?.addEventListener('click', close);

    backdrop.querySelector('#btnToggleSoundSetting')?.addEventListener('click', () => {
      this.settings.soundEnabled = !this.settings.soundEnabled;
      sound.setMuted(!this.settings.soundEnabled);
      saveSettings(this.settings);
      this.render();
    });

    backdrop.querySelector('#btnToggleMotionSetting')?.addEventListener('click', () => {
      this.settings.reducedMotion = !this.settings.reducedMotion;
      if (this.stadium) this.stadium.setReducedMotion(this.settings.reducedMotion);
      saveSettings(this.settings);
      this.render();
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
  }

  // --- ONLINE MULTIPLAYER MODAL & MATCHMAKING ---

  private openOnlineModal(initialRoomCode?: string): void {
    sound.playClick();
    this.ensureMultiplayerClient();
    this.onlineModalOpen = true;
    this.onlineStatusMessage = '';
    this.onlineWaitingForOpponent = false;

    if (initialRoomCode) {
      this.onlineRoomCode = initialRoomCode.toUpperCase().trim();
      this.connectToOnlineRoom(this.onlineRoomCode);
    } else {
      this.onlineRoomCode = '';
    }

    this.render();
  }

  private connectToOnlineRoom(roomCode: string): void {
    this.ensureMultiplayerClient();
    this.onlineWaitingForOpponent = true;
    this.onlineStatusMessage = `Connecting to room ${roomCode}...`;
    this.updateOnlineModal();
    this.multiplayerClient?.connect(roomCode, this.playerName);
  }

  private generateRoomCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 4; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  }

  private renderOnlineModal(): void {
    const backdrop = document.createElement('div');
    backdrop.className = 'game-over-modal-backdrop online-modal-backdrop';

    const isWaiting = this.onlineWaitingForOpponent && this.onlineRoomCode;
    const inviteLink = `${window.location.origin}${window.location.pathname}?room=${this.onlineRoomCode}`;

    backdrop.innerHTML = `
      <div class="online-modal-card">
        <div class="online-modal-header">
          <h2 class="online-modal-title">
            <span>🌐 ONLINE 1v1</span>
          </h2>
          <button class="btn-header-icon" id="btnCloseOnlineModal">✕</button>
        </div>

        <!-- Nickname Field -->
        <div class="online-nickname-row">
          <label class="online-input-label" for="txtPlayerName">YOUR NICKNAME</label>
          <input
            type="text"
            id="txtPlayerName"
            class="online-input-field"
            maxlength="14"
            value="${this.playerName}"
            placeholder="Enter nickname..."
            ${isWaiting ? 'disabled' : ''}
          />
        </div>

        ${
          isWaiting
            ? `
          <!-- Waiting in Room -->
          <div class="online-waiting-box">
            <div style="font-size:0.85rem; color:var(--muted); text-transform:uppercase; letter-spacing:1px;">
              ROOM CODE
            </div>
            <div class="online-room-code-display">${this.onlineRoomCode}</div>

            <div style="width:100%; display:flex; flex-direction:column; gap:6px; text-align:left;">
              <span class="online-input-label">SHARE INVITE LINK</span>
              <div class="online-share-bar">
                <input type="text" class="online-share-input" readonly value="${inviteLink}" id="txtInviteLink" />
                <button type="button" class="btn-copy-link" id="btnCopyInviteLink">COPY LINK</button>
              </div>
            </div>

            <div class="online-pulse-status">
              <span class="online-pulse-dot"></span>
              <span>${this.onlineStatusMessage || 'Waiting for rival to join...'}</span>
            </div>

            <button type="button" class="btn-online-cancel" id="btnCancelOnlineRoom">
              LEAVE ROOM
            </button>
          </div>
        `
            : `
          <!-- Lobby Actions -->
          <div class="online-sections-stack">
            <!-- Quick Match -->
            <div class="online-action-card">
              <div>
                <div class="online-card-title">⚡ QUICK MATCH</div>
                <p class="online-card-desc">Jump straight into a 1v1 shootout with a random rival online.</p>
              </div>
              <button class="online-card-btn btn-quick-match" id="btnStartQuickMatch">
                FIND MATCH
              </button>
            </div>

            <!-- Create Room -->
            <div class="online-action-card">
              <div>
                <div class="online-card-title">👥 PLAY WITH A FRIEND</div>
                <p class="online-card-desc">Create a private room and send the invite link or code to a friend.</p>
              </div>
              <button class="online-card-btn btn-create-room" id="btnCreatePrivateRoom">
                CREATE ROOM
              </button>
              
              <div class="online-join-row">
                <input
                  type="text"
                  id="txtJoinRoomCode"
                  class="online-input-field"
                  style="flex:1; text-transform:uppercase; letter-spacing:2px; font-weight:700;"
                  placeholder="ROOM CODE"
                  maxlength="8"
                />
                <button class="btn-join-code" id="btnJoinWithCode">
                  JOIN
                </button>
              </div>
            </div>
          </div>

          ${
            this.onlineStatusMessage
              ? `<div style="color:#F87171; font-size:0.85rem; text-align:center;">${this.onlineStatusMessage}</div>`
              : ''
          }
        `
        }
      </div>
    `;

    this.container.appendChild(backdrop);

    // Bindings
    const txtName = backdrop.querySelector<HTMLInputElement>('#txtPlayerName');
    txtName?.addEventListener('input', () => {
      this.playerName = txtName.value.trim() || 'Player 1';
      localStorage.setItem('penaltybros_player_name', this.playerName);
    });

    const closeBtn = backdrop.querySelector('#btnCloseOnlineModal');
    closeBtn?.addEventListener('click', () => {
      sound.playClick();
      this.closeOnlineModal();
    });

    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) {
        this.closeOnlineModal();
      }
    });

    // Quick match
    backdrop.querySelector('#btnStartQuickMatch')?.addEventListener('click', () => {
      sound.playClick();
      this.onlineRoomCode = 'QUICKMATCH';
      this.connectToOnlineRoom('QUICKMATCH');
    });

    // Create room
    backdrop.querySelector('#btnCreatePrivateRoom')?.addEventListener('click', () => {
      sound.playClick();
      const code = this.generateRoomCode();
      this.onlineRoomCode = code;
      this.connectToOnlineRoom(code);
    });

    // Join with code
    const btnJoin = backdrop.querySelector('#btnJoinWithCode');
    const txtJoin = backdrop.querySelector<HTMLInputElement>('#txtJoinRoomCode');
    const handleJoin = () => {
      const code = txtJoin?.value.trim().toUpperCase();
      if (!code) return;
      sound.playClick();
      this.onlineRoomCode = code;
      this.connectToOnlineRoom(code);
    };
    btnJoin?.addEventListener('click', handleJoin);
    txtJoin?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleJoin();
    });

    // Copy link
    backdrop.querySelector('#btnCopyInviteLink')?.addEventListener('click', () => {
      const copyBtn = backdrop.querySelector<HTMLButtonElement>('#btnCopyInviteLink');
      navigator.clipboard.writeText(inviteLink).then(() => {
        sound.playClick();
        if (copyBtn) {
          copyBtn.textContent = 'COPIED! ✓';
          copyBtn.classList.add('copied');
          setTimeout(() => {
            copyBtn.textContent = 'COPY LINK';
            copyBtn.classList.remove('copied');
          }, 2000);
        }
      });
    });

    // Cancel room
    backdrop.querySelector('#btnCancelOnlineRoom')?.addEventListener('click', () => {
      sound.playClick();
      this.multiplayerClient?.disconnect();
      this.onlineWaitingForOpponent = false;
      this.onlineRoomCode = '';
      this.onlineStatusMessage = '';
      this.updateOnlineModal();
    });
  }

  private updateOnlineModal(): void {
    if (!this.onlineModalOpen) return;
    const existing = this.container.querySelector('.online-modal-backdrop');
    if (existing) existing.remove();
    this.renderOnlineModal();
  }

  private closeOnlineModal(): void {
    this.onlineModalOpen = false;
    this.multiplayerClient?.disconnect();
    this.onlineWaitingForOpponent = false;
    this.onlineRoomCode = '';
    this.onlineStatusMessage = '';
    const existing = this.container.querySelector('.online-modal-backdrop');
    if (existing) existing.remove();
  }
}
