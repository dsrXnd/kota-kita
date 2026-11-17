# Art Style & Konsep Visual — KOTA KITA

Versi: 0.1 (Prototype) · Pasangan dokumen: `game-design.md`, `avatar-design.md`

## 1. Arah Visual

**3D stylized cartoon** — bentuk sederhana dan bersih, proporsi sedikit dilebihkan (gedung agak "gemuk", pohon bulat), tepi lembut, tanpa tekstur fotorealistik. Semua aset prototype dibuat dari primitif Three.js (box, cylinder, sphere, cone) dengan material flat/toon sederhana — gaya ini sengaja dipilih karena: (1) konsisten tanpa perlu artis 3D di tahap awal, (2) sangat ringan di GPU Android, (3) mudah diganti model .glb final nanti tanpa mengubah kode dunia (kontrak: satu fungsi builder per jenis objek).

**Karakter kota Indonesia modern:**
- Ruko 2–3 lantai dengan kanopi/awning warna-warni dan atap limasan (referensi atap joglo yang disederhanakan menjadi piramida segi empat).
- Satu bangunan publik dengan atap limasan besar sebagai landmark plaza.
- Vegetasi tropis: pohon beringin mini (kanopi bulat bertumpuk), palem (batang melengkung + daun menyebar), semak bulat.
- Elemen jalanan: lampu taman tiang hitam dengan bola lampu hangat, bangku kayu, pot tanaman, bendera merah-putih kecil di tiang landmark (elemen identitas, digambar generik tanpa logo apa pun).
- Kendaraan & warung masuk roadmap — belum di prototype.

Semua desain adalah karya orisinal proyek ini. Tidak menyalin aset, peta, logo, atau identitas visual dari game/situs mana pun.

## 2. Palet Warna (harmonis, tropis, cerah)

| Peran | Warna | Hex |
|-------|-------|-----|
| Langit siang | Biru langit lembut | `#8EC9E8` |
| Rumput | Hijau tropis segar | `#5FB96A` |
| Lantai plaza | Batu hangat terang | `#E8DCC8` |
| Jalan | Aspal abu hangat | `#6B6F76` |
| Dinding ruko A | Krem | `#F2E3C9` |
| Dinding ruko B | Terracotta lembut | `#E39A76` |
| Dinding ruko C | Sage | `#A8C3A0` |
| Dinding ruko D | Biru muda | `#9DB8D2` |
| Atap | Merah bata | `#B5533C` |
| Atap limasan landmark | Cokelat tua | `#7A4A2B` |
| Aksen awning | Merah / teal / kuning mustard | `#D64545` / `#2E8C83` / `#E3B23C` |
| Daun pohon | Hijau daun | `#3E9B4F` |
| Kayu | Cokelat kayu jati muda | `#9A6B43` |
| Air mancur | Biru air jernih | `#57B7D9` |
| Cahaya malam | Kuning lampu hangat | `#FFC978` |
| Langit malam | Biru malam | `#1E2A4A` |

Aturan palet: maksimal 1 warna jenuh kuat per objek; warna jenuh dipakai sebagai aksen (awning, atap, bunga), bukan bidang besar. Bidang besar selalu warna pastel/hangat agar kota terasa ramah dan tidak melelahkan mata.

## 3. Pencahayaan

- **Siang:** hemisphere light (langit/tanah) + directional light matahari dengan bayangan lembut (shadow map 2048 di PC, 1024 di Android — dideteksi dari devicePixelRatio/lebar layar), tone mapping ACES Filmic, exposure ±1,0.
- **Malam (toggle):** langit gelap, directional redup kebiruan (bulan), lampu taman menyala (emissive + PointLight terbatas hanya di landmark; lampu lain memakai emissive + sprite glow palsu demi performa).
- Transisi siang↔malam di-lerp ±1,5 detik, bukan potong kasar.
- Fog jauh berwarna langit untuk kesan kedalaman dan menyembunyikan batas dunia.

## 4. Peta Area — Plaza Utama (Prototype)

Ukuran dunia ± 90 × 90 m. Pusat koordinat (0,0) = air mancur.

```
                         U (Z-)
        ┌──────────────────────────────────────────────┐
        │  Ruko      Pohon    BALAI KOTA MINI   Pohon  │
        │ ┌────┐    (🌳)      ┌──────────┐      (🌳)   │
        │ │Ruko│              │ Atap     │             │
        │ └────┘              │ limasan  │   Ruko      │
        │        ═════════════╧══════════╧═════════    │
        │  Ruko   JALAN UTARA                          │
        │ ┌────┐      ┌─────────────────────┐   ┌────┐ │
        │ │Ruko│      │                     │   │Ruko│ │
        │ └────┘      │      PLAZA          │   └────┘ │
        │   ║         │   ┌─────────────┐   │      ║   │
        │ J ║         │   │  AIR MANCUR │   │      ║ J │
        │ A ║  Pohon  │   │   (tengah)  │   │ Pohon║ A │
        │ L ║  (🌳)   │   └─────────────┘   │  (🌳)║ L │
        │ A ║         │   Bangku · Lampu    │      ║ A │
        │ N ║         │                     │      ║ N │
        │   ║         └─────────────────────┘      ║   │
        │ B ║            JALAN SELATAN             ║ T │
        │ A ║   ┌────┐        ┌────┐       ┌────┐    ║ I │
        │ R ║   │Ruko│        │Kafe│       │Ruko│    ║ M │
        │ A ║   └────┘        └────┘       └────┘    ║ U │
        │ T ║     Papan Info (spawn)   Gerbang →     ║ R │
        └──────────────────────────────────────────────┘
                     (spawn pemain di selatan plaza)
```

- **Zona interaksi prototype:** Air Mancur (0,0), Papan Info (selatan, dekat spawn), Bangku taman (4 titik di plaza), Balai Kota Mini (utara, gerbang masuk roadmap).
- **Batas dunia:** pagar tanaman + deretan pohon; pemain ditahan collider sederhana (batas kotak ±42 m + lingkaran air mancur).
- **Area masa depan (terlihat sebagai gerbang/papan "Segera"):** Pasar (barat), Kampus (timur), Pantai (selatan jauh), Stasiun (utara jauh). Hanya penanda visual di roadmap, belum dibangun.

## 5. Aturan Performa Visual (Android)

- Total draw calls target < 300 di plaza: geometri & material dipakai ulang (shared), pohon/bangku/lampu dibuat dari fungsi builder yang sama.
- Tidak ada tekstur gambar di prototype — warna material saja. Tekstur final nanti maks. 512×512 per objek kecil, atlas untuk ruko.
- Bayangan: hanya matahari yang melempar bayangan; objek kecil (pot, bendera) tidak melempar bayangan.
- Pixel ratio dibatasi maks. 2 (dan 1,5 bila FPS rendah terdeteksi — penyesuaian otomatis masuk Tahap 2).
- Jarak pandang fog ± 120 m; tidak ada objek di luar ±60 m dari pusat kecuali siluet landmark.

## 6. UI Visual

- Font: sistem sans (cepat, tanpa unduh font) dengan bobot bold untuk tombol.
- HUD: panel semi-transparan gelap dengan sudut membulat 14 px, ikon emoji/teks besar yang jelas.
- Joystick: lingkaran dasar 120 px semi-transparan + knob 56 px.
- Bubble chat: putih, teks gelap, sudut membulat, maksimal 3 baris, hilang setelah 6 detik.
