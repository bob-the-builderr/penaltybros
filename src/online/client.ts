import { PartySocket } from 'partysocket';
import type {
  ClientMultiplayerMessage,
  ServerMultiplayerMessage,
  RoomStatus,
} from '../types/multiplayer';
import type { Direction, PlayerId } from '../types/game';

// In production, PartyKit will run on your deployed partykit domain (e.g. penaltybros.YOURNAME.partykit.dev)
// In local dev, PartyKit runs on localhost:1999
const DEFAULT_HOST =
  (import.meta as any).env?.VITE_PARTYKIT_HOST ||
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1'
    ? 'localhost:1999'
    : 'penaltybros.khalifa.partykit.dev');

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

export class MultiplayerClient {
  private socket: PartySocket | null = null;
  private callbacks: MultiplayerClientCallbacks;
  private currentRoomCode = '';
  private playerName = 'Player';
  public yourPlayerId: PlayerId = 'p1';

  constructor(callbacks: MultiplayerClientCallbacks) {
    this.callbacks = callbacks;
  }

  public connect(roomCode: string, playerName: string, host = DEFAULT_HOST): void {
    this.disconnect();
    this.currentRoomCode = roomCode.toUpperCase().trim();
    this.playerName = playerName.trim() || 'Player';

    this.socket = new PartySocket({
      host,
      room: this.currentRoomCode,
    });

    this.socket.addEventListener('open', () => {
      this.callbacks.onConnectionChange?.(true);
      this.send({ type: 'join', playerName: this.playerName });
    });

    this.socket.addEventListener('close', () => {
      this.callbacks.onConnectionChange?.(false);
    });

    this.socket.addEventListener('error', (err) => {
      console.error('[Multiplayer] Socket error:', err);
      this.callbacks.onError?.('Network error connecting to multiplayer server.');
    });

    this.socket.addEventListener('message', (event) => {
      this.handleServerMessage(event.data);
    });
  }

  public sendPick(round: number, direction: Direction): void {
    this.send({ type: 'pick', round, direction });
  }

  public requestRematch(): void {
    this.send({ type: 'rematch' });
  }

  public disconnect(): void {
    if (this.socket) {
      this.socket.close();
      this.socket = null;
    }
  }

  public getRoomCode(): string {
    return this.currentRoomCode;
  }

  private send(msg: ClientMultiplayerMessage): void {
    if (this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify(msg));
    }
  }

  private handleServerMessage(dataStr: string): void {
    try {
      const msg = JSON.parse(dataStr) as ServerMultiplayerMessage;

      switch (msg.type) {
        case 'room_state':
          this.callbacks.onRoomState?.(msg);
          break;

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

        case 'rematch_requested':
          this.callbacks.onRematchRequested?.(msg.requestedBy);
          break;

        case 'opponent_disconnected':
          this.callbacks.onOpponentDisconnected?.(msg.gracePeriodMs);
          break;

        case 'opponent_reconnected':
          this.callbacks.onOpponentReconnected?.();
          break;

        case 'opponent_forfeit':
          this.callbacks.onOpponentForfeit?.(msg.winner, msg.reason);
          break;

        case 'error':
          this.callbacks.onError?.(msg.message);
          break;
      }
    } catch (err) {
      console.error('[Multiplayer] Failed parsing server message:', err);
    }
  }
}

