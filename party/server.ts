import type * as Party from 'partykit/server';
import type {
  ClientMultiplayerMessage,
  ServerMultiplayerMessage,
  RoomPlayer,
  RoomStatus,
} from '../src/types/multiplayer';
import type { Direction, PlayerId } from '../src/types/game';
import { checkClinch } from '../src/logic/clinch';

export default class PenaltyServer implements Party.Server {
  private players: Map<string, RoomPlayer> = new Map();
  private p1ConnId: string | null = null;
  private p2ConnId: string | null = null;
  private status: RoomStatus = 'waiting';

  private currentRound = 1;
  private currentKickInRound = 0; // 0 = first kick of round, 1 = second kick
  private kickingFirst: PlayerId = 'p1';
  private currentShooter: PlayerId = 'p1';
  private currentKeeper: PlayerId = 'p2';

  private p1Score = 0;
  private p2Score = 0;
  private p1Kicks: (boolean | null)[] = [null, null, null, null, null];
  private p2Kicks: (boolean | null)[] = [null, null, null, null, null];

  private currentPicks: { p1?: Direction; p2?: Direction } = {};
  private roundTimer: ReturnType<typeof setTimeout> | null = null;
  private disconnectTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private rematchVotes: Set<PlayerId> = new Set();

  constructor(readonly room: Party.Room) {}

  onConnect(conn: Party.Connection, _ctx: Party.ConnectionContext) {
    // Check if re-connecting player
    let existingPlayerId: PlayerId | null = null;
    for (const p of this.players.values()) {
      if (!p.connected && (p.connectionId === conn.id || (p.id === 'p1' && !this.p1ConnId) || (p.id === 'p2' && !this.p2ConnId))) {
        existingPlayerId = p.id;
        break;
      }
    }

    if (existingPlayerId) {
      const p = existingPlayerId === 'p1' ? this.players.get(this.p1ConnId || '') : this.players.get(this.p2ConnId || '');
      if (p) {
        p.connected = true;
        p.connectionId = conn.id;
        if (existingPlayerId === 'p1') this.p1ConnId = conn.id;
        else this.p2ConnId = conn.id;

        // Cancel disconnect timer
        const timer = this.disconnectTimers.get(existingPlayerId);
        if (timer) {
          clearTimeout(timer);
          this.disconnectTimers.delete(existingPlayerId);
        }

        this.broadcastExcept(conn.id, { type: 'opponent_reconnected' });
        return;
      }
    }

    // Room full check
    const activeCount = (this.p1ConnId ? 1 : 0) + (this.p2ConnId ? 1 : 0);
    if (activeCount >= 2) {
      this.send(conn, { type: 'error', message: 'This room is already full.' });
      conn.close();
      return;
    }

    // Assign to p1 or p2 slot
    const assignedId: PlayerId = !this.p1ConnId ? 'p1' : 'p2';
    if (assignedId === 'p1') this.p1ConnId = conn.id;
    else this.p2ConnId = conn.id;

    this.players.set(conn.id, {
      id: assignedId,
      connectionId: conn.id,
      name: `Player ${assignedId === 'p1' ? '1' : '2'}`,
      connected: true,
    });

    this.broadcastRoomState();
  }

  onMessage(messageStr: string, sender: Party.Connection) {
    try {
      const msg = JSON.parse(messageStr) as ClientMultiplayerMessage;
      const player = this.players.get(sender.id);
      if (!player) return;

      if (msg.type === 'join') {
        if (msg.playerName && msg.playerName.trim()) {
          player.name = msg.playerName.trim().slice(0, 16);
        }

        // If both players are connected and named, start the match!
        if (this.p1ConnId && this.p2ConnId && this.status === 'waiting') {
          this.startMatch();
        } else {
          this.broadcastRoomState();
        }
        return;
      }

      if (msg.type === 'pick') {
        if (this.status !== 'playing') return;
        if (msg.round !== this.currentRound) return;

        const role = player.id;
        this.currentPicks[role] = msg.direction;

        // Notify rival that opponent has picked (hides direction)
        const opponentConnId = role === 'p1' ? this.p2ConnId : this.p1ConnId;
        if (opponentConnId) {
          const opponentConn = this.room.getConnection(opponentConnId);
          if (opponentConn) {
            this.send(opponentConn, { type: 'opponent_locked', playerId: role });
          }
        }

        // If both picks received, resolve immediately!
        if (this.currentPicks.p1 && this.currentPicks.p2) {
          if (this.roundTimer) {
            clearTimeout(this.roundTimer);
            this.roundTimer = null;
          }
          this.resolveRound();
        }
        return;
      }

      if (msg.type === 'rematch') {
        this.rematchVotes.add(player.id);
        this.broadcast({ type: 'rematch_requested', requestedBy: player.id });

        if (this.rematchVotes.has('p1') && this.rematchVotes.has('p2')) {
          this.startMatch(true);
        }
        return;
      }
    } catch (err) {
      console.error('Error handling message:', err);
    }
  }

  onClose(conn: Party.Connection) {
    const player = this.players.get(conn.id);
    if (!player) return;

    player.connected = false;
    if (this.p1ConnId === conn.id) this.p1ConnId = null;
    if (this.p2ConnId === conn.id) this.p2ConnId = null;

    if (this.status === 'playing' || this.status === 'revealing') {
      const gracePeriodMs = 15000;
      this.broadcast({ type: 'opponent_disconnected', gracePeriodMs });

      // Disconnect forfeit timer
      const forfeitTimer = setTimeout(() => {
        if (!player.connected) {
          const winner: PlayerId = player.id === 'p1' ? 'p2' : 'p1';
          this.status = 'game_over';
          this.broadcast({
            type: 'opponent_forfeit',
            winner,
            reason: `${player.name} disconnected.`,
          });
        }
      }, gracePeriodMs);

      this.disconnectTimers.set(player.id, forfeitTimer);
    } else {
      this.players.delete(conn.id);
      this.broadcastRoomState();
    }
  }

  private startMatch(isRematch = false) {
    if (!this.p1ConnId || !this.p2ConnId) return;

    const p1 = this.players.get(this.p1ConnId);
    const p2 = this.players.get(this.p2ConnId);
    if (!p1 || !p2) return;

    this.rematchVotes.clear();
    this.status = 'starting';

    // Alternate first kicker on rematch, or coin toss on initial match
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

    const p1Conn = this.room.getConnection(this.p1ConnId);
    const p2Conn = this.room.getConnection(this.p2ConnId);

    if (p1Conn) {
      this.send(p1Conn, {
        type: 'match_start',
        yourPlayerId: 'p1',
        p1Name: p1.name,
        p2Name: p2.name,
        firstKicker: this.kickingFirst,
      });
    }

    if (p2Conn) {
      this.send(p2Conn, {
        type: 'match_start',
        yourPlayerId: 'p2',
        p1Name: p1.name,
        p2Name: p2.name,
        firstKicker: this.kickingFirst,
      });
    }

    // Start Round 1
    setTimeout(() => {
      this.startRound();
    }, 1200);
  }

  private startRound() {
    this.status = 'playing';
    this.currentPicks = {};

    this.broadcast({
      type: 'round_start',
      roundNumber: this.currentRound,
      currentShooter: this.currentShooter,
      durationSec: 10,
    });

    // 10.5-second authoritative server timer
    if (this.roundTimer) clearTimeout(this.roundTimer);
    this.roundTimer = setTimeout(() => {
      this.handleTimeoutAutoPick();
    }, 10500);
  }

  private handleTimeoutAutoPick() {
    const directions: Direction[] = ['left', 'middle', 'right'];
    if (!this.currentPicks.p1) {
      this.currentPicks.p1 = directions[Math.floor(Math.random() * directions.length)];
    }
    if (!this.currentPicks.p2) {
      this.currentPicks.p2 = directions[Math.floor(Math.random() * directions.length)];
    }
    this.resolveRound();
  }

  private resolveRound() {
    this.status = 'revealing';

    const shooterDir = (this.currentShooter === 'p1' ? this.currentPicks.p1 : this.currentPicks.p2) || 'middle';
    const keeperDir = (this.currentKeeper === 'p1' ? this.currentPicks.p1 : this.currentPicks.p2) || 'middle';

    // Deterministic Shootout Rule: Same direction = save, Different direction = goal!
    const isGoal = shooterDir !== keeperDir;
    const outcome = isGoal ? 'goal' : 'save';

    // Update score
    if (isGoal) {
      if (this.currentShooter === 'p1') this.p1Score++;
      else this.p2Score++;
    }

    // Update kick history
    const shooterKicks = this.currentShooter === 'p1' ? this.p1Kicks : this.p2Kicks;
    const firstNullIdx = shooterKicks.findIndex((k) => k === null);
    if (firstNullIdx !== -1) {
      shooterKicks[firstNullIdx] = isGoal;
    } else {
      shooterKicks.push(isGoal);
    }

    const p1KicksTaken = this.p1Kicks.filter((k) => k !== null).length;
    const p2KicksTaken = this.p2Kicks.filter((k) => k !== null).length;

    // Check clinch / sudden death victory
    const clinch = checkClinch(this.p1Score, p1KicksTaken, this.p2Score, p2KicksTaken);

    this.broadcast({
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
    });

    if (clinch.isOver) {
      this.status = 'game_over';
      return;
    }

    // Rotate turns for next kick
    this.currentKickInRound++;
    if (this.currentKickInRound >= 2) {
      this.currentRound++;
      this.currentKickInRound = 0;

      // In sudden death, ensure equal slots
      if (this.currentRound > 5) {
        if (this.p1Kicks.length < this.currentRound) this.p1Kicks.push(null);
        if (this.p2Kicks.length < this.currentRound) this.p2Kicks.push(null);
      }

      this.currentShooter = this.kickingFirst;
      this.currentKeeper = this.kickingFirst === 'p1' ? 'p2' : 'p1';
    } else {
      // Second kick of the same round: swap shooter & keeper
      const prevShooter = this.currentShooter;
      this.currentShooter = this.currentKeeper;
      this.currentKeeper = prevShooter;
    }

    // Allow 2.6 seconds for client cinematic reveal + banner display before starting next round
    setTimeout(() => {
      this.startRound();
    }, 2600);
  }

  private broadcastRoomState() {
    const playersCount = (this.p1ConnId ? 1 : 0) + (this.p2ConnId ? 1 : 0);
    this.broadcast({
      type: 'room_state',
      roomCode: this.room.id,
      status: this.status,
      playersCount,
      waitingForOpponent: playersCount < 2,
    });
  }

  private send(conn: Party.Connection, msg: ServerMultiplayerMessage) {
    try {
      conn.send(JSON.stringify(msg));
    } catch (err) {
      console.error('Failed to send message:', err);
    }
  }

  private broadcast(msg: ServerMultiplayerMessage) {
    this.room.broadcast(JSON.stringify(msg));
  }

  private broadcastExcept(exceptConnId: string, msg: ServerMultiplayerMessage) {
    this.room.broadcast(JSON.stringify(msg), [exceptConnId]);
  }
}

