import { Schema, type } from "@colyseus/schema";

/**
 * Data satu pemain yang DIBAGIKAN ke semua klien (state publik).
 * Hanya data tampilan — tidak ada data akun/pribadi di sini.
 * File ini di folder players/ sesuai struktur proyek.
 */
export class Player extends Schema {
  @type("string") name: string = "Pemain";
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("number") z: number = 14;
  @type("number") rotY: number = 0;
  /** idle | walk | run | jump | wave */
  @type("string") anim: string = "idle";
  @type("string") shirt: string = "#d64545";
  @type("string") skin: string = "#f1c27d";
  @type("string") pants: string = "#3b4a6b";
  /** pendek | panjang | hijab | peci | botak */
  @type("string") hair: string = "pendek";
  @type("string") hairColor: string = "#3a2a1c";
  /** polos | batik | merahputih | koko | pesta (tiga terakhir musiman, Tahap 9) */
  @type("string") shirtStyle: string = "polos";
  /** Nama pengguna akun pemilik avatar ("" untuk tamu) — identitas publik untuk fitur teman. */
  @type("string") account: string = "";
}
