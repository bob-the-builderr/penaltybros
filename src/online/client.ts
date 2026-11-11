import { Peer, type DataConnection } from 'peerjs';
import type { Direction, PlayerId } from '../types/game';
import { checkClinch } from '../logic/clinch';

export type RoomStatus = 'waiting' | 'starting' | 'playing' | 'revealing' | 'game_over';

export interface MultiplayerClientCallbacks {
  onRoomState?: (state: {
    roomCode: string;
    status: RoomStatus;
    playersCount: number;
    waitingForOpponent: boolean;
  }) => void;
  onMatchStart?: (data: {
    yourPlayerId: PlayerId;
    p1Name: string;
    p2Name: string;
    firstKicker: PlayerId;
  }) => void;
  onRoundStart?: (data: {
    roundNumber: number;
    currentShooter: PlayerId;
    durationSec: number;
  }) => void;
  onOpponentLocked?: (playerId: PlayerId) => void;
  onRoundResult?: (data: {
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
  }) => void;
  onRematchRequested?: (requestedBy: PlayerId) => void;
  onOpponentDisconnected?: (gracePeriodMs: number) => void;
  onOpponentReconnected?: () => void;
  onOpponentForfeit?: (winner: PlayerId, reason: string) => void;
  onError?: (message: string) => void;
  onConnectionChange?: (connected: boolean) => void;
}

type P2PMessage =
  | { type: 'join'; playerName: string }
  | { type: 'match_start'; yourPlayerId: PlayerId; p1Name: string; p2Name: string; firstKicker: PlayerId }
  | { type: 'round_start'; roundNumber: number; currentShooter: PlayerId; durationSec: number }
  | { type: 'opponent_locked'; playerId: PlayerId }
  | { type: 'pick'; round: number; direction: Direction }
  | {
      type: 'round_result';
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
    }
  | { type: 'rematch_request'; requestedBy: PlayerId }
  | { type: 'error'; message: string };

const PEER_PREFIX = 'pb-v2-';

export class MultiplayerClient {
  private peer: Peer | null = null;
  private conn: DataConnection | null = null;
  private callbacks: MultiplayerClientCallbacks;

  private currentRoomCode = '';
  private playerName = 'Player';
  public yourPlayerId: PlayerId = 'p1';
  public isHost = false;

  // Host Authoritative State
  private status: RoomStatus = 'waiting';
  private p1Name = 'Player 1';
  private p2Name = 'Player 2';
  private kickingFirst: PlayerId = 'p1';
  private currentShooter: PlayerId = 'p1';
  private currentKeeper: PlayerId = 'p2';
  private currentRound = 1;
  private currentKickInRound = 0;
  private p1Score = 0;
  private p2Score = 0;
  private p1Kicks: (boolean | null)[] = [null, null, null, null, null];
  private p2Kicks: (boolean | null)[] = [null, null, null, null, null];
  private currentPicks: { p1?: Direction; p2?: Direction } = {};
  private roundTimer: number | null = null;
  private rematchVotes: Set<PlayerId> = new Set();
  private isDestroyed = false;

  constructor(callbacks: MultiplayerClientCallbacks) {
    this.callbacks = callbacks;
  }

  public getRoomCode(): string {
    return this.currentRoomCode;
  }

  public connect(roomCode: string, playerName: string): void {
    this.disconnect();
    this.isDestroyed = false;
    this.currentRoomCode = roomCode.toUpperCase().trim();
    this.playerName = playerName.trim() || 'Player';

    const cleanCode = this.currentRoomCode.toLowerCase().replace(/[^a-z0-9]/g, '');
    const hostPeerId = `${PEER_PREFIX}${cleanCode}-host`;

    // Try hosting the room first
    this.peer = new Peer(hostPeerId, {
      debug: 1,
    });

    this.peer.on('open', () => {
      // Successfully created as Host!
      this.isHost = true;
      this.yourPlayerId = 'p1';
      this.p1Name = this.playerName;
      this.callbacks.onConnectionChange?.(true);
      this.callbacks.onRoomState?.({
        roomCode: this.currentRoomCode,
        status: 'waiting',
        playersCount: 1,
        waitingForOpponent: true,
      });

      this.setupHostListeners();
    });

    this.peer.on('error', (err: any) => {
      if (this.isDestroyed) return;

      // If the host ID is already taken, someone is already hosting this room -> connect as Guest!
      if (err.type === 'unavailable-id') {
        this.connectAsGuest(hostPeerId);
      } else {
        console.error('[P2P Multiplayer] Peer error:', err);
        this.callbacks.onError?.('Network error connecting to multiplayer lobby.');
      }
    });
  }

  private connectAsGuest(hostPeerId: string): void {
    if (this.peer) {
      this.peer.destroy();
    }

    this.isHost = false;
    this.yourPlayerId = 'p2';

    // Guest gets an ephemeral ID
    this.peer = new Peer({
      debug: 1,
    });

    this.peer.on('open', () => {
      this.conn = this.peer!.connect(hostPeerId, {
        reliable: true,
      });

      this.conn.on('open', () => {
        this.callbacks.onConnectionChange?.(true);
        this.send({ type: 'join', playerName: this.playerName });
      });

      this.conn.on('data', (data: any) => {
        this.handleMessage(data as P2PMessage);
      });

      this.conn.on('close', () => {
        this.callbacks.onConnectionChange?.(false);
        this.callbacks.onOpponentDisconnected?.(15000);
      });

      this.conn.on('error', (err) => {
        console.error('[P2P Guest] Connection error:', err);
        this.callbacks.onError?.('Lost connection to host.');
      });
    });

    this.peer.on('error', (err) => {
      if (this.isDestroyed) return;
      console.error('[P2P Guest] Peer error:', err);
      this.callbacks.onError?.('Could not connect to rival room.');
    });
  }

  private setupHostListeners(): void {
    if (!this.peer) return;

    this.peer.on('connection', (conn) => {
      // If already playing with another player, reject 3rd joiner
      if (this.conn && this.conn.open) {
        conn.on('open', () => {
          conn.send({ type: 'error', message: 'Room is already full.' });
          conn.close();
        });
        return;
      }

      this.conn = conn;

      conn.on('open', () => {
        this.callbacks.onRoomState?.({
          roomCode: this.currentRoomCode,
          status: 'starting',
          playersCount: 2,
          waitingForOpponent: false,
        });
      });

      conn.on('data', (data: any) => {
        const msg = data as P2PMessage;

        if (msg.type === 'join') {
          this.p2Name = msg.playerName.trim().slice(0, 14) || 'Player 2';
          this.hostStartMatch();
          return;
        }

        if (msg.type === 'pick') {
          this.hostHandlePick('p2', msg.round, msg.direction);
          return;
        }

        if (msg.type === 'rematch_request') {
          this.rematchVotes.add('p2');
          this.callbacks.onRematchRequested?.('p2');
          this.broadcast({ type: 'rematch_request', requestedBy: 'p2' });
          if (this.rematchVotes.has('p1') && this.rematchVotes.has('p2')) {
            this.hostStartMatch(true);
          }
          return;
        }
      });

      conn.on('close', () => {
        this.callbacks.onOpponentDisconnected?.(15000);
      });
    });
  }

  public sendPick(round: number, direction: Direction): void {
    if (this.isHost) {
      this.hostHandlePick('p1', round, direction);
    } else {
      this.send({ type: 'pick', round, direction });
    }
  }

  public requestRematch(): void {
    if (this.isHost) {
      this.rematchVotes.add('p1');
      this.callbacks.onRematchRequested?.('p1');
      this.broadcast({ type: 'rematch_request', requestedBy: 'p1' });
      if (this.rematchVotes.has('p1') && this.rematchVotes.has('p2')) {
        this.hostStartMatch(true);
      }
    } else {
      this.send({ type: 'rematch_request', requestedBy: 'p2' });
    }
  }

  public disconnect(): void {
    this.isDestroyed = true;
    if (this.roundTimer !== null) {
      window.clearTimeout(this.roundTimer);
      this.roundTimer = null;
    }
    if (this.conn) {
      this.conn.close();
      this.conn = null;
    }
    if (this.peer) {
      this.peer.destroy();
      this.peer = null;
    }
    this.status = 'waiting';
    this.currentPicks = {};
    this.rematchVotes.clear();
  }

  // --- Host Authoritative Match Logic ---

  private hostStartMatch(isRematch = false): void {
    this.rematchVotes.clear();
    this.status = 'starting';

    if (isRematch) {
      this.kickingFirst = this.kickingFirst === 'p1' ? 'p2' : 'p1';
    } else {
      this.kickingFirst = Math.random() < 0.5 ? 'p1' : 'p2';
    }

    this.currentShooter = this.kickingFirst;
    this.currentKeeper = this.kickingFirst === 'p1' ? 'p2' : 'p1';
    this.currentRound = 1;
    this.currentKickInRound = 0;
    this.p1Score = 0;
    this.p2Score = 0;
    this.p1Kicks = [null, null, null, null, null];
    this.p2Kicks = [null, null, null, null, null];

    // Tell host client
    this.callbacks.onMatchStart?.({
      yourPlayerId: 'p1',
      p1Name: this.p1Name,
      p2Name: this.p2Name,
      firstKicker: this.kickingFirst,
    });

    // Tell guest client
    this.send({
      type: 'match_start',
      yourPlayerId: 'p2',
      p1Name: this.p1Name,
      p2Name: this.p2Name,
      firstKicker: this.kickingFirst,
    });

    window.setTimeout(() => {
      this.hostStartRound();
    }, 1200);
  }

  private hostStartRound(): void {
    this.status = 'playing';
    this.currentPicks = {};

    const roundData = {
      roundNumber: this.currentRound,
      currentShooter: this.currentShooter,
      durationSec: 10,
    };

    this.callbacks.onRoundStart?.(roundData);
    this.send({
      type: 'round_start',
      ...roundData,
    });

    if (this.roundTimer !== null) window.clearTimeout(this.roundTimer);
    this.roundTimer = window.setTimeout(() => {
      this.hostHandleTimeout();
    }, 10500);
  }

  private hostHandlePick(playerId: PlayerId, round: number, direction: Direction): void {
    if (this.status !== 'playing' || round !== this.currentRound) return;

    this.currentPicks[playerId] = direction;

    // Send secret "locked in" signal to the other player
    if (playerId === 'p1') {
      this.send({ type: 'opponent_locked', playerId: 'p1' });
    } else {
      this.callbacks.onOpponentLocked?.('p2');
    }

    // Both committed -> resolve round immediately!
    if (this.currentPicks.p1 && this.currentPicks.p2) {
      if (this.roundTimer !== null) {
        window.clearTimeout(this.roundTimer);
        this.roundTimer = null;
      }
      this.hostResolveRound();
    }
  }

  private hostHandleTimeout(): void {
    const dirs: Direction[] = ['left', 'middle', 'right'];
    if (!this.currentPicks.p1) {
      this.currentPicks.p1 = dirs[Math.floor(Math.random() * dirs.length)];
    }
    if (!this.currentPicks.p2) {
      this.currentPicks.p2 = dirs[Math.floor(Math.random() * dirs.length)];
    }
    this.hostResolveRound();
  }

  private hostResolveRound(): void {
    this.status = 'revealing';

    const shooterDir = (this.currentShooter === 'p1' ? this.currentPicks.p1 : this.currentPicks.p2) || 'middle';
    const keeperDir = (this.currentKeeper === 'p1' ? this.currentPicks.p1 : this.currentPicks.p2) || 'middle';

    // Shootout rule: same side = save, different = goal!
    const isGoal = shooterDir !== keeperDir;
    const outcome = isGoal ? 'goal' : 'save';

    if (isGoal) {
      if (this.currentShooter === 'p1') this.p1Score++;
      else this.p2Score++;
    }

    const shooterKicks = this.currentShooter === 'p1' ? this.p1Kicks : this.p2Kicks;
    const firstNull = shooterKicks.findIndex((k) => k === null);
    if (firstNull !== -1) shooterKicks[firstNull] = isGoal;
    else shooterKicks.push(isGoal);

    const p1KicksTaken = this.p1Kicks.filter((k) => k !== null).length;
    const p2KicksTaken = this.p2Kicks.filter((k) => k !== null).length;

    const clinch = checkClinch(this.p1Score, p1KicksTaken, this.p2Score, p2KicksTaken);

    const resultMsg: P2PMessage = {
      type: 'round_result',
      roundNumber: this.currentRound,
      shooterDir,
      keeperDir,
      outcome,
      p1Score: this.p1Score,
      p2Score: this.p2Score,
      p1Kicks: [...this.p1Kicks],
      p2Kicks: [...this.p2Kicks],
      isOver: clinch.isOver,
      winner: clinch.winner,
      clinchReason: clinch.reason || undefined,
    };

    // Trigger local host UI
    this.callbacks.onRoundResult?.(resultMsg);
    // Send to guest UI
    this.send(resultMsg);

    if (clinch.isOver) {
      this.status = 'game_over';
      return;
    }

    // Advance round
    this.currentKickInRound++;
    if (this.currentKickInRound >= 2) {
      this.currentRound++;
      this.currentKickInRound = 0;
      if (this.currentRound > 5) {
        if (this.p1Kicks.length < this.currentRound) this.p1Kicks.push(null);
        if (this.p2Kicks.length < this.currentRound) this.p2Kicks.push(null);
      }
      this.currentShooter = this.kickingFirst;
      this.currentKeeper = this.kickingFirst === 'p1' ? 'p2' : 'p1';
    } else {
      const prevShooter = this.currentShooter;
      this.currentShooter = this.currentKeeper;
      this.currentKeeper = prevShooter;
    }

    window.setTimeout(() => {
      this.hostStartRound();
    }, 2600);
  }

  // --- Network Transport ---

  private send(msg: P2PMessage): void {
    if (this.conn && this.conn.open) {
      this.conn.send(msg);
    }
  }

  private broadcast(msg: P2PMessage): void {
    this.send(msg);
  }

  private handleMessage(msg: P2PMessage): void {
    switch (msg.type) {
      case 'match_start':
        this.yourPlayerId = msg.yourPlayerId;
        this.callbacks.onMatchStart?.(msg);
        break;

      case 'round_start':
        this.callbacks.onRoundStart?.(msg);
        break;

      case 'opponent_locked':
        this.callbacks.onOpponentLocked?.(msg.playerId);
        break;

      case 'round_result':
        this.callbacks.onRoundResult?.(msg);
        break;

      case 'rematch_request':
        this.callbacks.onRematchRequested?.(msg.requestedBy);
        break;

      case 'error':
        this.callbacks.onError?.(msg.message);
        break;
    }
  }
}
