# Desain Avatar Utama — KOTA KITA

Versi: 0.1 (Prototype)

## 1. Proporsi & Gaya

Avatar manusia stylized dengan proporsi ramah (chibi ringan):

- Tinggi total ± 1,5 satuan dunia (± seperti manusia 1,5 m di skala plaza).
- Rasio kepala : badan ≈ 1 : 2,5 — kepala besar agar ekspresi & identitas terbaca dari jauh di layar HP kecil.
- Bentuk dari primitif lembut: kepala bola, badan kapsul, lengan & kaki kotak membulat (box), rambut topi setengah bola.
- Wajah minimal: dua mata hitam kecil + senyum (garis) — digambar sebagai bagian model sederhana; ekspresi tambahan masuk roadmap emote.

```
      ______
     / rambut \     <- setengah bola, warna bisa diganti
    |  ◉    ◉  |    <- kepala (bola) warna kulit
    |    ‿     |
     \________/
       | badan |    <- kapsul, warna baju
      /|      |\    <- lengan, ikut warna baju (lengan atas)
     / |      | \
       | celana|    <- warna celana
       | |  | |
       _|_  _|_     <- kaki/sepatu gelap
```

## 2. Bagian yang Bisa Dikustomisasi

| Slot | Prototype (Tahap 1) | Tahap 2 ✅ | Roadmap |
|------|--------------------|---------|---------|
| Nama tampilan | ✅ teks, maks. 16 karakter, label melayang di atas kepala | — | + gelar/emoji status |
| Warna kulit | ✅ 4 pilihan nada kulit | — | + lebih banyak nada |
| Warna baju | ✅ 6 warna | ✅ + model **batik** (motif prosedural) / polos | + kemeja, kaos lengan panjang |
| Warna celana | ✅ 4 warna | — | + rok, sarung, celana pendek |
| Rambut / penutup kepala | ✅ warna dasar | ✅ gaya: pendek, panjang, **hijab**, **peci**, botak + 6 warna | + sanggul, topi |
| Aksesori | Belum | Belum | Topi, kacamata, tas, dll. |

Aturan desain: semua pilihan warna memakai palet proyek (`art-style.md`) agar avatar selalu serasi dengan kota. Tidak ada opsi yang menyerupai logo/merek nyata.

## 3. Animasi (prosedural — tanpa file animasi)

Prototype menganimasikan avatar dengan rumus matematika sederhana di kode (bukan file .glb):

| Animasi | Cara kerja |
|---------|-----------|
| Idle | Napas halus: badan naik-turun sangat kecil, lengan diam |
| Walk | Lengan & kaki berayun berlawanan (sinus), badan sedikit memantul |
| Run | Ayunan lebih besar & cepat, badan condong ke depan sedikit |
| Jump | Kaki menekuk, lengan naik; mengikuti ketinggian dari fisika server |
| Wave (emote) | Lengan kanan naik & melambai ±2 detik |

Animasi digerakkan oleh state `anim` dari server untuk pemain lain, dan oleh input lokal untuk pemain sendiri — semua klien melihat gerakan yang sama.

## 4. Label Nama

Sprite teks (canvas) di atas kepala: nama putih dengan latar gelap semi-transparan membulat. Bubble chat muncul di atas label nama, maks. 3 baris, hilang setelah 6 detik. Label tidak pernah menutupi wajah avatar dari kamera standar.

## 5. Arah Pengembangan Art

1. Tahap 2: variasi gaya rambut & model baju dasar (tetap primitif).
2. Tahap 3: model .glb buatan Blender dengan rig sederhana menggantikan primitif — kontrak tampilannya mengikuti dokumen ini (proporsi & slot warna sama) agar kode jaringan tidak berubah.
3. Tahap 4: emote pack (duduk, menari, tertawa) & aksesori.
