import { Client, Room } from "colyseus.js";
import {
  ClientMessage,
  ServerMessage,
  type InputPayload,
  type ShootPayload,
} from "@mimic/shared";

export type ConnectMode =
  | { kind: "public"; name: string }
  | { kind: "create"; name: string }
  | { kind: "join"; name: string; code: string };

/** Thin, typed wrapper around a Colyseus room + a latency ping loop. */
export class NetworkClient {
  readonly client: Client;
  room: Room | null = null;
  roomCode = "";
  private httpBase: string;
  private pingTimer: number | null = null;
  private lastRtt = 0;

  constructor(serverUrl: string) {
    this.client = new Client(serverUrl);
    // Derive the HTTP(S) base from the WS(S) url for the code->roomId lookup.
    this.httpBase = serverUrl.replace(/^ws/, "http").replace(/\/$/, "");
  }

  async connect(mode: ConnectMode): Promise<Room> {
    let room: Room;
    if (mode.kind === "public") {
      room = await this.client.joinOrCreate("game", { mode: "public", name: mode.name });
    } else if (mode.kind === "create") {
      room = await this.client.create("game", { mode: "private", name: mode.name });
    } else {
      const code = mode.code.toUpperCase().trim();
      const res = await fetch(`${this.httpBase}/api/rooms/${encodeURIComponent(code)}`);
      if (res.status === 404) throw new Error("No room found with that code.");
      if (!res.ok) throw new Error("Could not reach the server.");
      const { roomId } = (await res.json()) as { roomId: string };
      room = await this.client.joinById(roomId, { name: mode.name });
    }
    this.room = room;

    room.onMessage(ServerMessage.Welcome, (m: { roomCode: string }) => {
      this.roomCode = m.roomCode;
    });
    room.onMessage(ServerMessage.Pong, (m: { t: number }) => {
      if (typeof m?.t === "number") this.lastRtt = Math.round(performance.now() - m.t);
    });

    this.startPing();
    return room;
  }

  private startPing() {
    this.stopPing();
    this.pingTimer = window.setInterval(() => {
      this.room?.send(ClientMessage.Ping, { t: performance.now(), rtt: this.lastRtt });
    }, 1000);
  }

  private stopPing() {
    if (this.pingTimer !== null) {
      window.clearInterval(this.pingTimer);
      this.pingTimer = null;
    }
  }

  get ping(): number {
    return this.lastRtt;
  }

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  // ---- typed send helpers -------------------------------------------------

  setName(name: string) {
    this.room?.send(ClientMessage.SetName, { name });
  }
  setReady(ready: boolean) {
    this.room?.send(ClientMessage.SetReady, { ready });
  }
  sendInput(p: InputPayload) {
    this.room?.send(ClientMessage.Input, p);
  }
  transform(propId: string) {
    this.room?.send(ClientMessage.Transform, { propId });
  }
  lockRotation(locked: boolean) {
    this.room?.send(ClientMessage.LockRotation, { locked });
  }
  shoot(p: ShootPayload) {
    this.room?.send(ClientMessage.Shoot, p);
  }
  reload() {
    this.room?.send(ClientMessage.Reload, {});
  }
  taunt() {
    this.room?.send(ClientMessage.Taunt, {});
  }
  decoy() {
    this.room?.send(ClientMessage.Decoy, {});
  }

  async leave() {
    this.stopPing();
    try {
      await this.room?.leave(true);
    } catch {
      /* ignore */
    }
    this.room = null;
  }
}
