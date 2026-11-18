import { Client, Room } from "colyseus.js";

export interface Profile {
  name: string;
  shirt: string;
  skin: string;
  pants: string;
  hair: string;
  hairColor: string;
  shirtStyle: string;
}

export interface ChatMessage {
  id: string;
  name: string;
  text: string;
}

export interface FriendInfo {
  username: string;
  name: string;
  online: boolean;
  lastOnline: number;
}

// ---------- Ekonomi (Tahap 5) ----------
// Semua angka di bawah ini CUMA tampilan dari pesan server — client tidak
// pernah menghitung saldo/kemajuan sendiri (server yang otoritatif).

export interface JobInfo {
  id: string;
  name: string;
  pay: number;
  desc: string;
  cooldownRemainingMs: number;
}

export interface ShiftInfo {
  jobId: string;
  name: string;
  pay: number;
  kind: string; // "stay" | "visit" | "deliver"
  progressMs: number;
  needMs: number;
  visitedCount: number;
  totalPoints: number;
  phase: string; // kurir: "pickup" | "deliver"
  targetName: string;
  deadline: number;
}

export interface JobsPayload {
  guest: boolean;
  balance: number | null;
  bonusAvailable: boolean;
  bonusAmount: number;
  jobs: JobInfo[];
  active: ShiftInfo | null;
}

export interface JobUpdate {
  active: ShiftInfo | null;
  message?: string;
  earned?: number;
}

// ---------- Perumahan (Tahap 6) ----------
// Kepemilikan dibaca dari state room (publik, tersinkron server); perintah
// klaim/bangun/teleport dikirim sebagai pesan dan divalidasi server.

export interface PlotInfo {
  owner: string;
  house: number;
}

export interface PlotResult {
  ok: boolean;
  message: string;
}

/**
 * Alamat server multiplayer:
 *  1. ?server=ws://... di URL (paling fleksibel), atau
 *  2. localStorage "kota-server", atau
 *  3. localhost → server pengembangan ws://localhost:2567, atau
 *  4. produksi: server game berjalan di alamat yang sama dengan websitenya
 *     (server Node menyajikan website + WebSocket sekaligus), atau
 *  5. LAN (HP satu jaringan dengan komputer pengembang): ws://<ip>:2567.
 */
export function serverEndpoint(): string {
  const fromUrl = new URLSearchParams(window.location.search).get("server");
  if (fromUrl) return fromUrl;
  const saved = window.localStorage.getItem("kota-server");
  if (saved) return saved;
  const host = window.location.hostname;
  if (host === "localhost" || host === "127.0.0.1") return "ws://localhost:2567";
  if (window.location.protocol === "https:") return `wss://${window.location.host}`;
  return `ws://${host}:2567`;
}

/**
 * Pembungkus jaringan Colyseus. Kalau server tidak terjangkau,
 * connect() mengembalikan false dan permainan lanjut dalam mode offline
 * (sendiri) — status selalu ditampilkan jujur di HUD.
 */
export class Network {
  private client: Client | null = null;
  room: Room | null = null;
  connected = false;

  onChat: ((msg: ChatMessage) => void) | null = null;
  onFriends: ((list: FriendInfo[]) => void) | null = null;
  onFriendsResult: ((ok: boolean, message: string) => void) | null = null;
  onReportResult: (() => void) | null = null;
  onBalance: ((balance: number) => void) | null = null;
  onBonusResult: ((ok: boolean, message: string) => void) | null = null;
  onJobs: ((payload: JobsPayload) => void) | null = null;
  onJobResult: ((ok: boolean, message: string) => void) | null = null;
  onJobUpdate: ((update: JobUpdate) => void) | null = null;
  onPlotResult: ((result: PlotResult) => void) | null = null;
  onHomeResult: ((result: PlotResult) => void) | null = null;

  async connect(profile: Profile, token?: string | null): Promise<boolean> {
    try {
      this.client = new Client(serverEndpoint());
      const joinPromise = this.client.joinOrCreate("kota", { ...profile, token: token ?? undefined });
      const timeout = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("timeout")), 7000)
      );
      this.room = (await Promise.race([joinPromise, timeout])) as Room;
      this.connected = true;
      this.room.onMessage("chat", (msg: ChatMessage) => this.onChat?.(msg));
      this.room.onMessage("friends", (data: { list: FriendInfo[] }) => this.onFriends?.(data.list ?? []));
      this.room.onMessage("friends_result", (data: { ok: boolean; message: string }) =>
        this.onFriendsResult?.(data.ok, data.message)
      );
      this.room.onMessage("report_result", () => this.onReportResult?.());
      this.room.onMessage("balance", (data: { balance: number }) => {
        if (typeof data?.balance === "number") this.onBalance?.(data.balance);
      });
      this.room.onMessage("bonus_result", (data: { ok: boolean; message: string }) =>
        this.onBonusResult?.(data.ok, data.message)
      );
      this.room.onMessage("jobs", (data: JobsPayload) => this.onJobs?.(data));
      this.room.onMessage("job_result", (data: { ok: boolean; message: string }) =>
        this.onJobResult?.(data.ok, data.message)
      );
      this.room.onMessage("job_update", (data: JobUpdate) => this.onJobUpdate?.(data));
      this.room.onMessage("plot_result", (data: PlotResult) => this.onPlotResult?.(data));
      this.room.onMessage("home_result", (data: PlotResult) => this.onHomeResult?.(data));
      this.room.onLeave(() => {
        this.connected = false;
      });
      return true;
    } catch {
      this.connected = false;
      this.room = null;
      return false;
    }
  }

  get sessionId(): string {
    return this.room?.sessionId ?? "";
  }

  /** State pemain dari server: MapSchema sessionId -> Player. */
  get players(): Map<string, any> | null {
    if (!this.room) return null;
    return (this.room.state as any)?.players ?? null;
  }

  get playerCount(): number {
    return this.players?.size ?? 0;
  }

  /** State kavling Kampung Kita dari server: MapSchema plotId -> { owner, house }. */
  get plots(): Map<string, PlotInfo> | null {
    if (!this.room) return null;
    return (this.room.state as any)?.plots ?? null;
  }

  /** Jumlah rumah berdiri di kota (dari state server). */
  get housesBuilt(): number {
    if (!this.room) return 0;
    return Number((this.room.state as any)?.housesBuilt ?? 0);
  }

  sendInput(x: number, z: number, sprint: boolean, jump: boolean) {
    if (this.connected && this.room) {
      this.room.send("input", { x, z, sprint, jump });
    }
  }

  sendChat(text: string) {
    if (this.connected && this.room) {
      this.room.send("chat", { text });
    }
  }

  sendEmote(emote: string) {
    if (this.connected && this.room) {
      this.room.send("emote", { emote });
    }
  }

  requestFriends() {
    if (this.connected && this.room) this.room.send("friends_get", {});
  }

  addFriend(username: string) {
    if (this.connected && this.room) this.room.send("friend_add", { username });
  }

  reportPlayer(targetId: string, reason: string) {
    if (this.connected && this.room) this.room.send("report", { targetId, reason });
  }

  // ---------- Ekonomi (Tahap 5) ----------
  requestBalance() {
    if (this.connected && this.room) this.room.send("balance_get", {});
  }

  requestJobs() {
    if (this.connected && this.room) this.room.send("jobs_get", {});
  }

  claimBonus() {
    if (this.connected && this.room) this.room.send("bonus_claim", {});
  }

  startJob(jobId: string) {
    if (this.connected && this.room) this.room.send("job_start", { jobId });
  }

  cancelJob() {
    if (this.connected && this.room) this.room.send("job_cancel", {});
  }

  // ---------- Perumahan (Tahap 6) ----------
  claimPlot(plotId: string) {
    if (this.connected && this.room) this.room.send("plot_claim", { plotId });
  }

  buildHouse(tier: number) {
    if (this.connected && this.room) this.room.send("plot_build", { tier });
  }

  goHome() {
    if (this.connected && this.room) this.room.send("home", {});
  }

  disconnect() {
    this.room?.leave();
    this.room = null;
    this.connected = false;
  }
}
