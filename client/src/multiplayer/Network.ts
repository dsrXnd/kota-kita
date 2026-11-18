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

// ---------- Ekonomi (Tahap 5 + 6B) ----------
// Semua angka di bawah ini CUMA tampilan dari pesan server — client tidak
// pernah menghitung saldo/kemajuan sendiri (server yang otoritatif).

export interface JobInfo {
  id: string;
  name: string;
  pay: number;
  desc: string;
  nightOnly: boolean;
  skipFee: number;
  cooldownMs: number;
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
  phase: string; // deliver: "pickup" | "deliver"
  pickupName: string;
  targetName: string;
  deadline: number;
  /** Tujuan sif saat ini untuk panah penunjuk (Tahap 10) — dari server. */
  objective: { x: number; z: number; label: string };
}

/** Statistik satu pekerjaan milik akun ini (Tahap 10) — dihitung server sejak Tahap 10. */
export interface JobStatInfo {
  done: number;
  failed: number;
  earned: number;
}

export interface JobsPayload {
  guest: boolean;
  balance: number | null;
  bonusAvailable: boolean;
  /** Hadiah KC bila check-in diklaim sekarang (tangga streak Tahap 6B). */
  bonusReward: number;
  /** Hari siklus streak (1..7) untuk klaim berikutnya. */
  bonusStreakDay: number;
  /** Total hari beruntun saat ini. */
  streakCount: number;
  /** Sisa jatah skip cooldown berbayar hari ini. */
  skipAttemptsLeft: number;
  isNight: boolean;
  /** 2 pekerjaan pilihan akun ini (Tahap 10); [] = belum memilih / tamu. */
  chosenJobs: string[];
  /** True bila akun belum memilih 2 pekerjaannya (panel tampil mode memilih). */
  needsChoice: boolean;
  /** Biaya ganti pilihan pekerjaan (KC terbakar). */
  changeFee: number;
  /** Statistik pekerjaan per akun (Tahap 10): jobId -> { done, failed, earned }. */
  jobStats: Record<string, JobStatInfo>;
  jobs: JobInfo[];
  actives: ShiftInfo[];
  /** Quest sosial harian sesi ini (Tahap 9) — kosong untuk tamu. */
  quests: QuestInfo[];
}

/** Hasil memilih/mengganti pekerjaan (Tahap 10). */
export interface JobChooseResult {
  ok: boolean;
  message: string;
  /** KC yang terbakar untuk ganti pilihan (0 = pilihan pertama, gratis). */
  charged?: number;
}

/** Sif selesai (Tahap 10) — untuk kartu hasil & reaksi avatar. */
export interface JobDoneInfo {
  jobId: string;
  name: string;
  pay: number;
  cooldownMs: number;
  balance: number;
}

/** Sif gagal (Tahap 10) — untuk kartu hasil & reaksi avatar. */
export interface JobFailedInfo {
  jobId: string;
  name: string;
  reason: string;
}

// ---------- Quest Sosial Harian (Tahap 9) ----------
// Kemajuan & hadiah dihitung server; client hanya menampilkan.

export interface QuestInfo {
  id: string;
  name: string;
  icon: string;
  desc: string;
  reward: number;
  progress: number;
  target: number;
  done: boolean;
}

export interface QuestUpdate {
  quests: QuestInfo[];
  reward?: number;
  balance?: number;
  message?: string;
}

export interface JobUpdate {
  actives: ShiftInfo[];
  message?: string;
  earned?: number;
}

// ---------- Kebutuhan hidup (Tahap 6B) ----------

export interface NeedsInfo {
  hunger: number;
  thirst: number;
  toilet: number;
  warnAt: number;
}

export interface NeedsResult {
  ok: boolean;
  message: string;
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

// ---------- Usaha Pemain (Tahap 7) ----------
// Kepemilikan, nama & menu dibaca dari state room (publik); perintah
// klaim/beli/ambil kas dikirim sebagai pesan dan divalidasi server.
// Kas usaha & log penjualan TIDAK ada di state — hanya datang lewat
// pesan privat "lapak_mine" untuk pemiliknya.

export interface LapakItemInfo {
  price: number;
  stocked: boolean;
}

export interface LapakInfo {
  owner: string;
  name: string;
  menu: Map<string, LapakItemInfo>;
}

export interface LapakSaleInfo {
  buyer: string;
  item: string;
  price: number;
  ts: number;
}

/** Data privat lapak milik sesi ini (kas, log penjualan, suvenir) — dari server, hanya untuk pemilik. */
export interface LapakMine {
  lapakId: string; // "" = belum punya lapak
  kas: number;
  sales: LapakSaleInfo[];
  souvenirs: number;
}

export interface LapakResult {
  ok: boolean;
  message: string;
}

// ---------- Kota Hidup (Tahap 8) ----------
// Statistik, Kabar Kota & status voting datang dari payload server lewat
// pesan "city" (balasan city_get / vote_cast). Fasilitas aktif dibaca dari
// state room. Client tidak menghitung apa pun sendiri.

export interface CityNewsEntry {
  ts: number;
  icon: string;
  text: string;
}

export interface CityVoteInfo {
  facilityId: string;
  name: string;
  icon: string;
  desc: string;
  yes: number;
  no: number;
  closesAt: number;
  /** Ambang minimal suara setuju agar lolos. */
  minYes: number;
  /** Pilihan sesi ini: "" (belum), "yes", atau "no". */
  myVote: string;
}

export interface CityLastResult {
  facilityId: string;
  name: string;
  icon: string;
  passed: boolean;
  yes: number;
  no: number;
}

export interface CityPayload {
  guest: boolean;
  residents: number;
  online: number;
  houses: number;
  lapaks: number;
  kasKota: number;
  news: CityNewsEntry[];
  vote: CityVoteInfo | null;
  lastResult: CityLastResult | null;
  facilities: string[];
}

export interface VoteResult {
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
  onJobChooseResult: ((result: JobChooseResult) => void) | null = null;
  onJobDone: ((info: JobDoneInfo) => void) | null = null;
  onJobFailed: ((info: JobFailedInfo) => void) | null = null;
  onSkipResult: ((ok: boolean, message: string) => void) | null = null;
  onNeeds: ((needs: NeedsInfo) => void) | null = null;
  onNeedsResult: ((result: NeedsResult) => void) | null = null;
  onPlotResult: ((result: PlotResult) => void) | null = null;
  onHomeResult: ((result: PlotResult) => void) | null = null;
  onLapakResult: ((result: LapakResult) => void) | null = null;
  onLapakMine: ((mine: LapakMine) => void) | null = null;
  onLapakEvent: ((message: string) => void) | null = null;
  onCity: ((payload: CityPayload) => void) | null = null;
  onVoteResult: ((result: VoteResult) => void) | null = null;
  onCityEvent: ((message: string) => void) | null = null;
  onNewsUpdate: (() => void) | null = null;
  onQuestUpdate: ((update: QuestUpdate) => void) | null = null;

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
      this.room.onMessage("job_choose_result", (data: JobChooseResult) => this.onJobChooseResult?.(data));
      this.room.onMessage("job_done", (data: JobDoneInfo) => this.onJobDone?.(data));
      this.room.onMessage("job_failed", (data: JobFailedInfo) => this.onJobFailed?.(data));
      this.room.onMessage("job_skip_result", (data: { ok: boolean; message: string }) =>
        this.onSkipResult?.(data.ok, data.message)
      );
      this.room.onMessage("needs", (data: NeedsInfo) => this.onNeeds?.(data));
      this.room.onMessage("needs_result", (data: NeedsResult) => this.onNeedsResult?.(data));
      this.room.onMessage("plot_result", (data: PlotResult) => this.onPlotResult?.(data));
      this.room.onMessage("home_result", (data: PlotResult) => this.onHomeResult?.(data));
      this.room.onMessage("lapak_result", (data: LapakResult) => this.onLapakResult?.(data));
      this.room.onMessage("lapak_mine", (data: LapakMine) => this.onLapakMine?.(data));
      this.room.onMessage("lapak_event", (data: { message: string }) => {
        if (typeof data?.message === "string") this.onLapakEvent?.(data.message);
      });
      this.room.onMessage("city", (data: CityPayload) => this.onCity?.(data));
      this.room.onMessage("vote_result", (data: VoteResult) => this.onVoteResult?.(data));
      this.room.onMessage("city_event", (data: { message: string }) => {
        if (typeof data?.message === "string") this.onCityEvent?.(data.message);
      });
      this.room.onMessage("news_update", () => this.onNewsUpdate?.());
      this.room.onMessage("quest_update", (data: QuestUpdate) => this.onQuestUpdate?.(data));
      this.room.onMessage("quests", (data: { quests: QuestInfo[] }) => {
        if (Array.isArray(data?.quests)) this.onQuestUpdate?.({ quests: data.quests });
      });
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

  /** State lapak Pasar dari server: MapSchema lapakId -> { owner, name, menu }. */
  get lapaks(): Map<string, LapakInfo> | null {
    if (!this.room) return null;
    return (this.room.state as any)?.lapaks ?? null;
  }

  /** Jumlah lapak yang sudah dimiliki warga (dari state server). */
  get lapaksActive(): number {
    if (!this.room) return 0;
    return Number((this.room.state as any)?.lapaksActive ?? 0);
  }

  /** Fraksi hari dunia 0..1 dari jam server (Tahap 6B) — sama untuk semua pemain. */
  get worldTime(): number {
    if (!this.room) return 0;
    return Number((this.room.state as any)?.worldTime ?? 0);
  }

  /** Apakah dunia sedang malam menurut jam server. */
  get worldIsNight(): boolean {
    if (!this.room) return false;
    return Boolean((this.room.state as any)?.isNight ?? false);
  }

  /** Id fasilitas kota yang sudah terbangun (dari state server, Tahap 8). */
  get facilities(): string[] {
    if (!this.room) return [];
    const arr = (this.room.state as any)?.facilities;
    if (!arr) return [];
    const out: string[] = [];
    const len = typeof arr.length === "number" ? arr.length : 0;
    for (let i = 0; i < len; i++) out.push(String(arr[i]));
    return out;
  }

  /** Event komunitas aktif dari state server (Tahap 9); null = tidak ada event. */
  get activeEvent(): { type: string; name: string; endsAt: number } | null {
    if (!this.room) return null;
    const s = this.room.state as any;
    const type = String(s?.eventType ?? "");
    if (!type) return null;
    return { type, name: String(s?.eventName ?? ""), endsAt: Number(s?.eventEndsAt ?? 0) };
  }

  /** Musim kosmetik aktif menurut server (Tahap 9); null = tidak ada musim. */
  get activeSeason(): { style: string; label: string } | null {
    if (!this.room) return null;
    const s = this.room.state as any;
    const style = String(s?.seasonStyle ?? "");
    if (!style) return null;
    return { style, label: String(s?.seasonLabel ?? "") };
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

  requestQuests() {
    if (this.connected && this.room) this.room.send("quests_get", {});
  }

  claimBonus() {
    if (this.connected && this.room) this.room.send("bonus_claim", {});
  }

  startJob(jobId: string) {
    if (this.connected && this.room) this.room.send("job_start", { jobId });
  }

  /** Pilih / ganti 2 pekerjaan milik akun ini (Tahap 10) — divalidasi & dibiayai server. */
  chooseJobs(jobIds: string[]) {
    if (this.connected && this.room) this.room.send("job_choose", { jobIds });
  }

  cancelJob(jobId?: string) {
    if (this.connected && this.room) this.room.send("job_cancel", jobId ? { jobId } : {});
  }

  skipJob(jobId: string) {
    if (this.connected && this.room) this.room.send("job_skip", { jobId });
  }

  // ---------- Kebutuhan hidup (Tahap 6B) ----------
  requestNeeds() {
    if (this.connected && this.room) this.room.send("needs_get", {});
  }

  refillNeed(action: string) {
    if (this.connected && this.room) this.room.send("need_refill", { action });
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

  // ---------- Usaha Pemain (Tahap 7) ----------
  claimLapak(lapakId: string) {
    if (this.connected && this.room) this.room.send("lapak_claim", { lapakId });
  }

  setLapakName(name: string) {
    if (this.connected && this.room) this.room.send("lapak_set_name", { name });
  }

  setLapakItem(itemId: string, price: number, stocked: boolean) {
    if (this.connected && this.room) this.room.send("lapak_set_item", { itemId, price, stocked });
  }

  buyLapakItem(lapakId: string, itemId: string) {
    if (this.connected && this.room) this.room.send("lapak_buy", { lapakId, itemId });
  }

  collectKas() {
    if (this.connected && this.room) this.room.send("lapak_collect", {});
  }

  requestMyLapak() {
    if (this.connected && this.room) this.room.send("lapak_mine_get", {});
  }

  // ---------- Kota Hidup (Tahap 8) ----------
  requestCity() {
    if (this.connected && this.room) this.room.send("city_get", {});
  }

  castVote(choice: "yes" | "no") {
    if (this.connected && this.room) this.room.send("vote_cast", { choice });
  }

  disconnect() {
    this.room?.leave();
    this.room = null;
    this.connected = false;
  }
}
