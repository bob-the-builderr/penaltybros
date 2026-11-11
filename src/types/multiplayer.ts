import type { Direction, PlayerId } from './game';

export type RoomStatus =
  | 'waiting'
  | 'starting'
  | 'playing'
  | 'revealing'
  | 'game_over';

export interface RoomPlayer {
  id: PlayerId;
  connectionId: string;
  name: string;
  connected: boolean;
}

// Messages sent from Client -> PartyKit Server
export type ClientMultiplayerMessage =
  | { type: 'join'; playerName: string }
  | { type: 'pick'; round: number; direction: Direction }
  | { type: 'rematch' };

// Messages sent from PartyKit Server -> Client
export type ServerMultiplayerMessage =
  | {
      type: 'room_state';
      roomCode: string;
      status: RoomStatus;
      playersCount: number;
      waitingForOpponent: boolean;
    }
  | {
      type: 'match_start';
      yourPlayerId: PlayerId;
      p1Name: string;
      p2Name: string;
      firstKicker: PlayerId;
    }
  | {
      type: 'round_start';
      roundNumber: number;
      currentShooter: PlayerId;
      durationSec: number;
    }
  | {
      type: 'opponent_locked';
      playerId: PlayerId;
    }
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
  | {
      type: 'rematch_requested';
      requestedBy: PlayerId;
    }
  | {
      type: 'opponent_disconnected';
      gracePeriodMs: number;
    }
  | {
      type: 'opponent_reconnected';
    }
  | {
      type: 'opponent_forfeit';
      winner: PlayerId;
      reason: string;
    }
  | {
      type: 'error';
      message: string;
    };

