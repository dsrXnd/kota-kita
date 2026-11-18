/**
 * Quest Sosial Harian (Tahap 9) — tiga quest ringan per hari kalender
 * Asia/Jakarta, khusus warga berakun, berhadiah KC kecil (tanpa grind:
 * masing-masing hanya bisa dibayar SEKALI sehari).
 *
 * Kemajuan tersimpan per akun di AccountStore (kolom economy.quests)
 * dan diatur ulang otomatis saat hari kalender berganti. Hadiah dibayar
 * SEKETIKA saat quest tuntas lewat jalur kredit store yang sama seperti
 * gaji & kas usaha (applyDelta + catatan ledger) — client hanya menerima
 * hasilnya, tidak pernah menghitung kemajuan sendiri.
 *
 * Definisi quest & zona jelajah hidup di file ini (satu-satunya sumber
 * kebenaran server); room yang mencicipi peristiwa (zona dikunjungi,
 * emote wave di dekat warga, sif selesai) dan meneruskannya ke store.
 */

export interface QuestDef {
  id: string;
  name: string;
  icon: string;
  desc: string;
  /** Hadiah KC, dibayar sekali sehari saat target tercapai. */
  reward: number;
  /** Target kemajuan (kawasan berbeda / warga berbeda / sif). */
  target: number;
}

/** Tiga quest harian — angka keputusan desain Tahap 9 (hadiah kecil, tanpa grind). */
export const QUESTS: ReadonlyArray<QuestDef> = [
  {
    id: "jelajah",
    name: "Jelajah Kota",
    icon: "🗺️",
    desc: "Kunjungi 3 kawasan berbeda hari ini: Plaza Utama, Balai Kota, Kampung Kita, Pasar, atau Pantai.",
    reward: 25,
    target: 3,
  },
  {
    id: "sapa",
    name: "Sapa Warga",
    icon: "👋",
    desc: "Lambaikan tangan (emote 👋 Melambai) di dekat 5 warga berakun yang BERBEDA hari ini.",
    reward: 10,
    target: 5,
  },
  {
    id: "kerja",
    name: "Kerja Keras",
    icon: "💼",
    desc: "Selesaikan 1 sif pekerjaan apa pun hari ini.",
    reward: 5,
    target: 1,
  },
];
export const QUEST_BY_ID: ReadonlyMap<string, QuestDef> = new Map(QUESTS.map((q) => [q.id, q]));

export interface QuestZone {
  id: string;
  name: string;
  x: number;
  z: number;
  radius: number;
}

/** Kawasan yang dihitung quest Jelajah Kota (pusat + radius, meter dunia). */
export const QUEST_ZONES: ReadonlyArray<QuestZone> = [
  { id: "plaza", name: "Plaza Utama", x: 0, z: 0, radius: 12 },
  { id: "balai", name: "Balai Kota", x: 0, z: -27, radius: 8 },
  { id: "kampung", name: "Kampung Kita", x: 90, z: 0, radius: 20 },
  { id: "pasar", name: "Pasar", x: 0, z: 52, radius: 14 },
  { id: "pantai", name: "Pantai", x: -62, z: 0, radius: 16 },
];
export const QUEST_ZONE_BY_ID: ReadonlyMap<string, QuestZone> = new Map(QUEST_ZONES.map((z) => [z.id, z]));

/** Radius sapaan quest Sapa Warga: emote wave dihitung untuk warga berakun dalam jarak ini. */
export const GREET_RADIUS = 6;

/** Keadaan quest satu akun pada satu hari kalender (disimpan di economy.quests). */
export interface QuestDayData {
  /** Kunci hari Asia/Jakarta keadaan ini berlaku. */
  day: string;
  /** Id zona yang sudah dikunjungi hari ini. */
  zones: string[];
  /** Kunci akun warga yang sudah disapa hari ini. */
  greeted: string[];
  /** Sudah menyelesaikan >= 1 sif hari ini. */
  jobDone: boolean;
  /** Id quest yang hadiahnya sudah dibayar hari ini. */
  paid: string[];
}

export function emptyQuestDay(day: string): QuestDayData {
  return { day, zones: [], greeted: [], jobDone: false, paid: [] };
}

/** Kemajuan satu quest untuk ditampilkan client (murni tampilan dari data server). */
export interface QuestProgressInfo {
  id: string;
  name: string;
  icon: string;
  desc: string;
  reward: number;
  progress: number;
  target: number;
  done: boolean;
}

/** Kemajuan mentah per quest id dari data harian (sebelum digabung definisi). */
export function questProgressOf(data: QuestDayData, questId: string): number {
  switch (questId) {
    case "jelajah":
      return Math.min(data.zones.length, QUEST_BY_ID.get("jelajah")!.target);
    case "sapa":
      return Math.min(data.greeted.length, QUEST_BY_ID.get("sapa")!.target);
    case "kerja":
      return data.jobDone ? 1 : 0;
    default:
      return 0;
  }
}

/** Daftar status semua quest dari data harian — bentuk yang dikirim ke client. */
export function questStatusList(data: QuestDayData): QuestProgressInfo[] {
  return QUESTS.map((def) => {
    const progress = questProgressOf(data, def.id);
    return {
      id: def.id,
      name: def.name,
      icon: def.icon,
      desc: def.desc,
      reward: def.reward,
      progress,
      target: def.target,
      done: progress >= def.target,
    };
  });
}
