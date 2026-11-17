import { Room, Client } from "colyseus";
import { Schema, MapSchema, type } from "@colyseus/schema";
import { Player } from "../players/Player";
import { resolveCollisions } from "./colliders";
import { accounts, type ProfileData } from "../accounts/store";

export class KotaState extends Schema {
  @type({ map: Player }) players = new MapSchema<Player>();
}

interface InputData {
  x: number; // arah dunia -1..1 (sudah relatif kamera dari klien)
  z: number;
  sprint: boolean;
  jump: boolean;
}

interface JoinOptions {
  name?: string;
  shirt?: string;
  skin?: string;
  pants?: string;
  hair?: string;
  hairColor?: string;
  shirtStyle?: string;
  /** Token sesi akun (Tahap 3) — bila sah, profil akun dimuat & disimpan. */
  token?: string;
}

const HAIR_STYLES = ["pendek", "panjang", "hijab", "peci", "botak"];
const SHIRT_STYLES = ["polos", "batik"];

/** Emote yang sah + durasinya (ms). "sit" batal otomatis saat pemain bergerak. */
const EMOTES: Record<string, number> = {
  wave: 2000,
  dance: 4000,
  laugh: 2500,
  clap: 2000,
  sit: 6000,
};

// Konstanta gerak — HARUS sama dengan prediksi gerak di client (main.ts).
export const WALK_SPEED = 4;
export const RUN_SPEED = 7;
export const GRAVITY = 22;
export const JUMP_VELOCITY = 8.2;
const WORLD_BOUND = 42; // pemain ditahan di kotak ±42 m
const FOUNTAIN_RADIUS = 3.6; // lingkaran tabrakan air mancur di (0,0)
const CHAT_MAX = 120;
const CHAT_MIN_INTERVAL_MS = 800;

// Daftar kata kasar dasar untuk sensor chat prototype.
// Tahap 3+ memakai moderasi yang lebih lengkap.
const BAD_WORDS = ["anjing", "bangsat", "tolol", "goblok", "bego", "kontol", "memek", "ngentot", "fuck", "shit", "bitch"];

function cleanName(raw: unknown): string {
  if (typeof raw !== "string") return "Pemain";
  const cleaned = raw.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 16);
  return cleaned.length > 0 ? cleaned : "Pemain";
}

function cleanColor(raw: unknown, fallback: string): string {
  if (typeof raw === "string" && /^#[0-9a-fA-F]{6}$/.test(raw)) return raw;
  return fallback;
}

function filterChat(text: string): string {
  let out = text;
  for (const w of BAD_WORDS) {
    const re = new RegExp(w, "gi");
    out = out.replace(re, "***");
  }
  return out;
}

export class KotaRoom extends Room<KotaState> {
  private inputs = new Map<string, InputData>();
  private verticalVel = new Map<string, number>();
  private emoteUntil = new Map<string, { name: string; until: number }>();
  private lastEmoteAt = new Map<string, number>();
  private lastChatAt = new Map<string, number>();
  /** sessionId -> username akun (huruf kecil), hanya untuk pemain yang masuk dengan akun. */
  private sessionAccount = new Map<string, string>();
  /** 30 chat terakhir — konteks saat ada laporan moderasi. */
  private recentChats: Array<{ name: string; text: string; ts: number }> = [];

  onCreate() {
    this.setState(new KotaState());
    this.maxClients = 50;

    this.onMessage("input", (client, data: Partial<InputData>) => {
      // Server tidak memercayai klien: hanya arah yang diterima,
      // besarnya dinormalisasi ke maksimum 1.
      let x = Number(data?.x) || 0;
      let z = Number(data?.z) || 0;
      const len = Math.hypot(x, z);
      if (len > 1) {
        x /= len;
        z /= len;
      }
      this.inputs.set(client.sessionId, {
        x,
        z,
        sprint: data?.sprint === true,
        jump: data?.jump === true,
      });
    });

    this.onMessage("chat", (client, data: { text?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      const now = Date.now();
      if (now - (this.lastChatAt.get(client.sessionId) ?? 0) < CHAT_MIN_INTERVAL_MS) return;
      if (typeof data?.text !== "string") return;
      const text = filterChat(data.text.trim().slice(0, CHAT_MAX));
      if (!text) return;
      this.lastChatAt.set(client.sessionId, now);
      this.broadcast("chat", { id: client.sessionId, name: player.name, text });
      // Log chat di server (moderasi Tahap 3) + simpan konteks terakhir.
      this.recentChats.push({ name: player.name, text, ts: now });
      if (this.recentChats.length > 30) this.recentChats.shift();
      accounts.appendChatLog({
        ts: now,
        account: this.sessionAccount.get(client.sessionId) ?? null,
        name: player.name,
        text,
      });
    });

    // --- Teman (Tahap 3): data privat per akun, dikirim hanya ke pemiliknya. ---
    this.onMessage("friends_get", (client) => {
      client.send("friends", { list: this.friendListFor(client.sessionId) });
    });

    this.onMessage("friend_add", (client, data: { username?: unknown }) => {
      const me = this.sessionAccount.get(client.sessionId);
      if (!me) {
        client.send("friends_result", { ok: false, message: "Masuk dengan akun dulu untuk menambah teman." });
        return;
      }
      if (typeof data?.username !== "string" || !data.username.trim()) {
        client.send("friends_result", { ok: false, message: "Isi nama pengguna temanmu." });
        return;
      }
      const result = accounts.addFriend(me, data.username);
      client.send("friends_result", {
        ok: result.ok,
        message: result.ok ? `${data.username} ditambahkan ke temanmu 🎉` : result.error,
      });
      if (result.ok) client.send("friends", { list: this.friendListFor(client.sessionId) });
    });

    // --- Moderasi: laporan pemain (disimpan di server, bukan di client). ---
    this.onMessage("report", (client, data: { targetId?: unknown; reason?: unknown }) => {
      const target = typeof data?.targetId === "string" ? this.state.players.get(data.targetId) : undefined;
      if (!target) return;
      const reporter = this.state.players.get(client.sessionId);
      accounts.appendReport({
        ts: Date.now(),
        reporter: reporter?.name ?? "?",
        reporterAccount: this.sessionAccount.get(client.sessionId) ?? null,
        target: target.name,
        targetAccount: typeof data?.targetId === "string" ? this.sessionAccount.get(data.targetId) ?? null : null,
        reason: typeof data?.reason === "string" ? data.reason.slice(0, 200) : "",
        recentChats: this.recentChats.slice(-10),
      });
      client.send("report_result", { ok: true });
    });

    this.onMessage("emote", (client, data: { emote?: unknown }) => {
      const player = this.state.players.get(client.sessionId);
      if (!player) return;
      // Jeda minimal antar emote (anti-spam).
      const now = Date.now();
      if (now - (this.lastEmoteAt.get(client.sessionId) ?? 0) < 600) return;
      if (typeof data?.emote === "string" && data.emote in EMOTES) {
        this.lastEmoteAt.set(client.sessionId, now);
        this.emoteUntil.set(client.sessionId, {
          name: data.emote,
          until: now + EMOTES[data.emote],
        });
      }
    });

    // Simulasi gerak otoritatif, 20x per detik.
    this.setSimulationInterval((deltaMs) => this.simulate(deltaMs / 1000), 50);
  }

  onJoin(client: Client, options: JoinOptions) {
    const player = new Player();

    // Tahap 3: bila token akun sah, profil tersimpan menjadi dasar,
    // pilihan tampilan terbaru dari layar mulai menimpanya lalu disimpan lagi.
    const accountKey = accounts.verifyToken(options?.token);
    const base: ProfileData | null = accountKey ? accounts.getUser(accountKey)?.profile ?? null : null;

    player.name = cleanName(options?.name ?? base?.name);
    player.shirt = cleanColor(options?.shirt, base?.shirt ?? player.shirt);
    player.skin = cleanColor(options?.skin, base?.skin ?? player.skin);
    player.pants = cleanColor(options?.pants, base?.pants ?? player.pants);
    player.hairColor = cleanColor(options?.hairColor, base?.hairColor ?? player.hairColor);
    const hairPick = options?.hair ?? base?.hair;
    if (typeof hairPick === "string" && HAIR_STYLES.includes(hairPick)) player.hair = hairPick;
    const stylePick = options?.shirtStyle ?? base?.shirtStyle;
    if (typeof stylePick === "string" && SHIRT_STYLES.includes(stylePick)) player.shirtStyle = stylePick;

    if (accountKey) {
      this.sessionAccount.set(client.sessionId, accountKey);
      player.account = accounts.getUser(accountKey)?.username ?? "";
      accounts.saveProfile(accountKey, {
        name: player.name,
        shirt: player.shirt,
        skin: player.skin,
        pants: player.pants,
        hair: player.hair,
        hairColor: player.hairColor,
        shirtStyle: player.shirtStyle,
      });
    }
    // Spawn: sekitar papan info di selatan plaza (0, 14), acak ringan.
    player.x = (Math.random() - 0.5) * 4;
    player.z = 14 + (Math.random() - 0.5) * 2;
    player.rotY = Math.PI; // menghadap plaza (utara)
    this.state.players.set(client.sessionId, player);
    console.log(`[kota] ${player.name} masuk (${client.sessionId}) — total pemain: ${this.state.players.size}`);
    this.inputs.set(client.sessionId, { x: 0, z: 0, sprint: false, jump: false });
    this.verticalVel.set(client.sessionId, 0);
  }

  onLeave(client: Client) {
    const accountKey = this.sessionAccount.get(client.sessionId);
    if (accountKey) accounts.touchOnline(accountKey);
    this.sessionAccount.delete(client.sessionId);
    this.state.players.delete(client.sessionId);
    this.inputs.delete(client.sessionId);
    this.verticalVel.delete(client.sessionId);
    this.emoteUntil.delete(client.sessionId);
    this.lastEmoteAt.delete(client.sessionId);
    this.lastChatAt.delete(client.sessionId);
  }

  /** Daftar teman untuk satu sesi (kosong untuk tamu), lengkap dengan status online. */
  private friendListFor(sessionId: string) {
    const me = this.sessionAccount.get(sessionId);
    if (!me) return [];
    const user = accounts.getUser(me);
    if (!user) return [];
    const onlineAccounts = new Set(this.sessionAccount.values());
    return user.friends.map((friendKey) => {
      const friend = accounts.getUser(friendKey);
      return {
        username: friend?.username ?? friendKey,
        name: friend?.profile.name ?? friendKey,
        online: onlineAccounts.has(friendKey),
        lastOnline: friend?.lastOnline ?? 0,
      };
    });
  }

  private simulate(dt: number) {
    const now = Date.now();
    this.state.players.forEach((player, sessionId) => {
      const input = this.inputs.get(sessionId) ?? { x: 0, z: 0, sprint: false, jump: false };
      const moving = Math.abs(input.x) > 0.01 || Math.abs(input.z) > 0.01;
      const speed = input.sprint ? RUN_SPEED : WALK_SPEED;

      if (moving) {
        player.x += input.x * speed * dt;
        player.z += input.z * speed * dt;
        player.rotY = Math.atan2(input.x, input.z);
      }

      // Lompat & gravitasi sederhana.
      let vy = this.verticalVel.get(sessionId) ?? 0;
      if (input.jump && player.y <= 0) {
        vy = JUMP_VELOCITY;
        input.jump = false; // konsumsi agar tidak lompat terus
      }
      if (player.y > 0 || vy !== 0) {
        player.y += vy * dt;
        vy -= GRAVITY * dt;
        if (player.y <= 0) {
          player.y = 0;
          vy = 0;
        }
      }
      this.verticalVel.set(sessionId, vy);

      // Batas dunia.
      player.x = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, player.x));
      player.z = Math.max(-WORLD_BOUND, Math.min(WORLD_BOUND, player.z));

      // Tabrakan air mancur: dorong keluar lingkaran.
      const distFountain = Math.hypot(player.x, player.z);
      if (distFountain < FOUNTAIN_RADIUS && distFountain > 0.0001) {
        const push = FOUNTAIN_RADIUS / distFountain;
        player.x *= push;
        player.z *= push;
      }

      // Tabrakan bangunan (AABB sederhana).
      resolveCollisions(player);

      // Animasi. Emote yang masih aktif menang, kecuali pemain sedang di udara.
      const emote = this.emoteUntil.get(sessionId);
      const emoteActive = emote && emote.until > now && player.y <= 0.05;
      if (emoteActive && emote.name === "sit" && moving) {
        this.emoteUntil.delete(sessionId); // duduk batal saat bergerak
      }
      if (emoteActive && !(emote.name === "sit" && moving)) player.anim = emote.name;
      else if (player.y > 0.05) player.anim = "jump";
      else if (moving) player.anim = input.sprint ? "run" : "walk";
      else player.anim = "idle";
    });
  }
}
