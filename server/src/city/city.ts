import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "fs";
import { join } from "path";

/**
 * Kota Hidup — Statistik, Kabar Kota & Voting Fasilitas (Tahap 8).
 *
 * Semua data "kota" hidup di modul ini dan disimpan persisten di
 * server/data/city.json (pola atomik yang sama seperti plots.json &
 * market.json): kas kota (penghitung statistik), umpan Kabar Kota
 * (maks. 50 entri terakhir), dan keadaan voting fasilitas (antrean,
 * usulan aktif + suara per akun, hasil terakhir, fasilitas terbangun).
 *
 * Kas kota BUKAN saldo yang bisa dibelanjakan siapa pun — ia hanya
 * penghitung kumulatif KC yang masuk dari biaya klaim kavling, bangun/
 * upgrade rumah, dan klaim lapak (diisi room di titik yang sama dengan
 * pemotongan spendKC yang berhasil). Biaya skip cooldown TIDAK masuk
 * kas kota karena terbakar dari peredaran (keputusan Tahap 6B).
 * Penghitung mulai dari 0 sejak Tahap 8 — tidak ada riwayat mundur,
 * karena tahap-tahap sebelumnya memang tidak mencatatnya.
 */

// ---------- Katalog fasilitas (aset disiapkan lebih dulu, diaktifkan server) ----------

export interface FacilityDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Pusat kawasan fasilitas (meter dunia). */
  cx: number;
  cz: number;
}

/**
 * Katalog fasilitas yang bisa diusulkan & dibangun lewat voting.
 * Urutan antrean awal = urutan daftar ini. Lokasi dipilih di lahan
 * kosong barat & utara plaza — tidak menabrak ruko/balai kota (plaza),
 * Kampung Kita (timur), maupun Pasar (selatan):
 * - Taman Bunga: pojok barat laut, tengah (-36, -32).
 * - Lapangan Futsal: barat daya, tengah (-36, 32).
 * - Perpustakaan Mini: jalur utara di belakang ruko, tengah (-24, -39).
 */
export const FACILITIES: ReadonlyArray<FacilityDef> = [
  {
    id: "taman_bunga",
    name: "Taman Bunga",
    icon: "🌷",
    desc: "Taman bunga warna-warni di pojok barat laut plaza — bedeng bunga, bangku, dan pohon peneduh untuk bersantai.",
    cx: -36,
    cz: -32,
  },
  {
    id: "lapangan_futsal",
    name: "Lapangan Futsal",
    icon: "⚽",
    desc: "Lapangan futsal mini di barat daya plaza — lapangan hijau bergaris putih dengan dua gawang untuk main bareng warga.",
    cx: -36,
    cz: 32,
  },
  {
    id: "perpustakaan",
    name: "Perpustakaan Mini",
    icon: "📚",
    desc: "Perpustakaan mini di jalur utara belakang ruko — tempat baca yang tenang untuk warga kota.",
    cx: -24,
    cz: -39,
  },
];
export const FACILITY_BY_ID: ReadonlyMap<string, FacilityDef> = new Map(FACILITIES.map((f) => [f.id, f]));

type Box = readonly [number, number, number, number];

/** Bedeng bunga Taman Bunga: [tengah x, tengah z, lebar x, kedalaman z]. */
const TAMAN_BEDS: ReadonlyArray<readonly [number, number, number, number]> = [
  [-39.2, -34.6, 3.6, 1.4],
  [-32.8, -34.6, 3.6, 1.4],
  [-39.2, -29.4, 3.6, 1.4],
  [-32.8, -29.4, 3.6, 1.4],
];
/** Gawang Lapangan Futsal (di dua ujung lapangan z 24..40): [minX, maxX, minZ, maxZ]. */
const FUTSAL_GOALS: ReadonlyArray<Box> = [
  [-38.5, -33.5, 24.2, 25.0],
  [-38.5, -33.5, 39.0, 39.8],
];
/** Dinding Perpustakaan Mini: satu kotak sebesar bangunannya. */
const PERPUSTAKAAN_BOX: Box = [-28, -20, -41.25, -36.75];

/**
 * Kotak tabrakan (AABB) satu fasilitas: [minX, maxX, minZ, maxZ].
 * HARUS sama dengan client (client/src/world/Fasilitas.ts). Fasilitas
 * yang belum aktif TIDAK punya kotak — tanahnya bebas dilewati.
 */
export function facilityBoxes(facilityId: string): ReadonlyArray<Box> {
  switch (facilityId) {
    case "taman_bunga":
      return TAMAN_BEDS.map(([cx, cz, w, d]) => [cx - w / 2, cx + w / 2, cz - d / 2, cz + d / 2] as Box);
    case "lapangan_futsal":
      return FUTSAL_GOALS;
    case "perpustakaan":
      return [PERPUSTAKAAN_BOX];
    default:
      return [];
  }
}

// ---------- Voting ----------

/** Ambang minimal suara SETUJU agar usulan bisa lolos (selain harus > suara tolak). */
export const MIN_YES = 3;

/**
 * Panjang jendela voting dalam menit: bawaan 1440 = 24 jam asli.
 * Bisa diatur lewat variabel lingkungan KOTA_VOTE_MINUTES (desimal
 * diperbolehkan) — HANYA konfigurasi saat server menyala, sama seperti
 * KOTA_TIME_OFFSET_MIN; bukan pesan/endpoint curang saat permainan jalan.
 */
export function voteWindowMs(): number {
  const m = Number(process.env.KOTA_VOTE_MINUTES);
  return (Number.isFinite(m) && m > 0 ? m : 1440) * 60 * 1000;
}

/** Teks ramah untuk panjang jendela voting saat ini (untuk Kabar Kota & panel). */
export function voteWindowText(): string {
  const ms = voteWindowMs();
  if (ms >= 60 * 60 * 1000) {
    const h = Math.round(ms / (60 * 60 * 1000));
    return `${h} jam`;
  }
  const m = Math.max(1, Math.round(ms / 60000));
  return `${m} menit`;
}

// ---------- Penyimpanan kota (persisten, pola sama seperti plots.json) ----------

export interface NewsEntry {
  ts: number;
  icon: string;
  text: string;
}

export interface ProposalState {
  facilityId: string;
  openedAt: number;
  /** Batas akhir voting (ms epoch) — persisten agar restart tidak mengulang jendela. */
  closesAt: number;
  /** Kunci akun (huruf kecil) -> pilihan finalnya. Satu akun satu suara. */
  votes: Record<string, "yes" | "no">;
}

export interface VoteResult {
  facilityId: string;
  passed: boolean;
  yes: number;
  no: number;
  closedAt: number;
}

interface CityDB {
  kasKota: number;
  news: NewsEntry[];
  /** Id fasilitas yang sudah terbangun (aktif di dunia). */
  built: string[];
  /** Antrean id fasilitas yang belum terbangun (selain yang sedang divoting). */
  queue: string[];
  active: ProposalState | null;
  lastResult: VoteResult | null;
}

const DATA_DIR = process.env.KOTA_DATA_DIR || join(process.cwd(), "data");
const CITY_FILE = join(DATA_DIR, "city.json");
const MAX_NEWS = 50;

export class CityStore {
  private db: CityDB;

  constructor() {
    mkdirSync(DATA_DIR, { recursive: true });
    let loaded: Partial<CityDB> = {};
    if (existsSync(CITY_FILE)) {
      try {
        loaded = JSON.parse(readFileSync(CITY_FILE, "utf8")) as CityDB;
      } catch {
        loaded = {};
      }
    }
    this.db = {
      kasKota: typeof loaded.kasKota === "number" && Number.isFinite(loaded.kasKota) ? loaded.kasKota : 0,
      news: Array.isArray(loaded.news) ? loaded.news : [],
      built: Array.isArray(loaded.built) ? loaded.built.filter((id) => FACILITY_BY_ID.has(id)) : [],
      queue: [],
      active: null,
      lastResult: loaded.lastResult ?? null,
    };
    // Antrean = fasilitas yang belum terbangun & tidak sedang divoting,
    // mengikuti urutan katalog; entri tersimpan yang masih sah dipertahankan
    // urutannya (fasilitas yang gagal voting sudah dipindah room/store ke
    // belakang antrean tersimpan).
    const savedQueue = Array.isArray(loaded.queue) ? loaded.queue : [];
    const activeId =
      loaded.active && FACILITY_BY_ID.has(loaded.active.facilityId) ? loaded.active.facilityId : null;
    if (activeId && loaded.active) {
      this.db.active = {
        facilityId: activeId,
        openedAt: loaded.active.openedAt ?? Date.now(),
        closesAt: loaded.active.closesAt ?? Date.now() + voteWindowMs(),
        votes: loaded.active.votes ?? {},
      };
    }
    const inQueue = new Set<string>();
    for (const id of savedQueue) {
      if (FACILITY_BY_ID.has(id) && !this.db.built.includes(id) && id !== activeId && !inQueue.has(id)) {
        this.db.queue.push(id);
        inQueue.add(id);
      }
    }
    for (const def of FACILITIES) {
      if (!this.db.built.includes(def.id) && def.id !== activeId && !inQueue.has(def.id)) {
        this.db.queue.push(def.id);
        inQueue.add(def.id);
      }
    }
  }

  private save() {
    const tmp = CITY_FILE + ".tmp";
    writeFileSync(tmp, JSON.stringify(this.db, null, 1));
    renameSync(tmp, CITY_FILE);
  }

  // ---------- Kas kota (statistik) ----------

  /** Tambah KC ke penghitung kas kota (dipanggil room tepat saat klaim/bangun berhasil dibayar). */
  addKas(amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.db.kasKota += amount;
    this.save();
  }

  kasKotaAmount(): number {
    return this.db.kasKota;
  }

  // ---------- Kabar Kota ----------

  /** Tambah satu entri Kabar Kota (maks. 50 terakhir disimpan). */
  addNews(icon: string, text: string) {
    this.db.news.push({ ts: Date.now(), icon, text });
    if (this.db.news.length > MAX_NEWS) this.db.news = this.db.news.slice(-MAX_NEWS);
    this.save();
  }

  /** N entri Kabar Kota terakhir, TERBARU di depan. */
  recentNews(n: number): NewsEntry[] {
    return this.db.news.slice(-n).reverse();
  }

  newsCount(): number {
    return this.db.news.length;
  }

  // ---------- Fasilitas terbangun ----------

  isBuilt(facilityId: string): boolean {
    return this.db.built.includes(facilityId);
  }

  /** Id semua fasilitas yang sudah terbangun (aktif di dunia). */
  builtIds(): string[] {
    return [...this.db.built];
  }

  // ---------- Voting ----------

  activeProposal(): ProposalState | null {
    return this.db.active;
  }

  lastResult(): VoteResult | null {
    return this.db.lastResult;
  }

  /** Hitung suara usulan aktif (atau usulan tertentu). */
  tally(proposal: ProposalState | null = this.db.active): { yes: number; no: number } {
    let yes = 0;
    let no = 0;
    if (proposal) {
      for (const v of Object.values(proposal.votes)) {
        if (v === "yes") yes++;
        else no++;
      }
    }
    return { yes, no };
  }

  /** Pilihan akun pada usulan aktif ("yes" | "no" | null = belum memilih). */
  myVote(accountKey: string): "yes" | "no" | null {
    if (!this.db.active) return null;
    return this.db.active.votes[accountKey] ?? null;
  }

  /**
   * Pastikan ada usulan aktif bila masih ada fasilitas belum terbangun:
   * ambil kepala antrean, buka jendela voting, catat di Kabar Kota.
   * Mengembalikan usulan aktif (atau null bila semua sudah terbangun).
   */
  ensureProposal(): ProposalState | null {
    if (this.db.active) return this.db.active;
    const nextId = this.db.queue.shift();
    if (!nextId) return null;
    const def = FACILITY_BY_ID.get(nextId);
    if (!def) return null;
    const now = Date.now();
    this.db.active = { facilityId: nextId, openedAt: now, closesAt: now + voteWindowMs(), votes: {} };
    this.addNews(
      "🗳️",
      `Voting dibuka: usulan fasilitas ${def.icon} ${def.name}. Warga berakun boleh memilih — 1 akun 1 suara, jendela ${voteWindowText()}, lolos bila setuju minimal ${MIN_YES} dan lebih banyak dari menolak.`
    );
    this.save();
    return this.db.active;
  }

  /**
   * Catat satu suara. Satu akun = satu suara, FINAL (tidak bisa diubah
   * atau diulang pada usulan yang sama) — penolakan dikembalikan sebagai
   * error untuk diteruskan room ke pemilih.
   */
  castVote(
    accountKey: string,
    choice: "yes" | "no"
  ): { ok: boolean; yes: number; no: number; error?: string } {
    const active = this.db.active;
    if (!active) return { ok: false, yes: 0, no: 0, error: "Saat ini tidak ada usulan yang sedang divoting." };
    if (Date.now() >= active.closesAt) {
      return { ok: false, ...this.tally(), error: "Jendela voting usulan ini sudah berakhir." };
    }
    if (active.votes[accountKey]) {
      return {
        ok: false,
        ...this.tally(),
        error: "Kamu sudah memilih pada usulan ini — satu akun satu suara dan bersifat final.",
      };
    }
    active.votes[accountKey] = choice;
    this.save();
    return { ok: true, ...this.tally() };
  }

  /**
   * Nilai penutupan usulan aktif: bila jendela sudah berakhir, tutup
   * usulan (lolos → fasilitas langsung terbangun; gagal → fasilitas
   * pindah ke BELAKANG antrean), catat hasil + kabarnya, lalu buka
   * usulan berikutnya. Mengembalikan hasil penutupan (null = belum waktunya).
   * Dipanggil room berkala (loop) dan saat room dibuat (catch-up bila
   * tenggat lewat saat server mati).
   */
  evaluateClosing(): VoteResult | null {
    const active = this.db.active;
    if (!active) return null;
    if (Date.now() < active.closesAt) return null;
    const def = FACILITY_BY_ID.get(active.facilityId);
    const { yes, no } = this.tally(active);
    const passed = yes >= MIN_YES && yes > no;
    const result: VoteResult = {
      facilityId: active.facilityId,
      passed,
      yes,
      no,
      closedAt: Date.now(),
    };
    this.db.lastResult = result;
    this.db.active = null;
    if (def) {
      if (passed) {
        this.db.built.push(def.id);
        this.addNews(
          "✅",
          `Voting selesai: ${def.icon} ${def.name} LOLOS (setuju ${yes} · tolak ${no}). Usulan disetujui warga!`
        );
        this.addNews("🎉", `Fasilitas baru selesai dibangun: ${def.icon} ${def.name}. Datang dan nikmati ya!`);
      } else {
        this.db.queue.push(def.id);
        this.addNews(
          "❌",
          `Voting selesai: ${def.icon} ${def.name} belum lolos (setuju ${yes} · tolak ${no} — perlu setuju minimal ${MIN_YES} dan lebih banyak dari menolak). Usulan masuk antrean lagi.`
        );
      }
    }
    this.save();
    this.ensureProposal();
    return result;
  }
}

/** Singleton yang dipakai server HTTP & room Colyseus. */
export const city = new CityStore();
