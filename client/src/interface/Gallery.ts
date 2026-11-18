/**
 * Galeri Foto perangkat (Tahap 9) — penyimpanan foto mode foto di
 * IndexedDB PERANGKAT pemain sendiri.
 *
 * BY DESIGN tidak ada unggahan ke server: foto hanya hidup di browser
 * perangkat ini (sama seperti unduhan PNG-nya). Menghapus data situs di
 * browser akan menghapus galeri ini juga. Semua fungsi FAIL-SOFT: bila
 * IndexedDB tidak tersedia/gagal, fungsi mengembalikan nilai kosong/
 * false dan mode foto tetap mengunduh seperti biasa — tidak ada error
 * yang dilempar ke pemanggil.
 */

export interface GalleryPhoto {
  /** Id = cap waktu pengambilan (ms epoch) — unik & terurut alami. */
  id: number;
  ts: number;
  dataUrl: string;
}

const DB_NAME = "kota-kita-gallery";
const STORE_NAME = "photos";

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const transaction = db.transaction(STORE_NAME, mode);
          const req = run(transaction.objectStore(STORE_NAME));
          req.onsuccess = () => resolve(req.result ?? null);
          req.onerror = () => resolve(null);
          transaction.oncomplete = () => db.close();
          transaction.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      })
  );
}

/** Simpan satu tangkapan (data URL PNG). true = tersimpan di galeri perangkat. */
export async function savePhoto(dataUrl: string): Promise<boolean> {
  if (!dataUrl) return false;
  const now = Date.now();
  const photo: GalleryPhoto = { id: now, ts: now, dataUrl };
  const result = await tx<IDBValidKey>("readwrite", (store) => store.put(photo));
  return result !== null;
}

/** Semua foto tersimpan, TERBARU di depan. [] bila galeri kosong/tidak tersedia. */
export async function listPhotos(): Promise<GalleryPhoto[]> {
  const all = await tx<GalleryPhoto[]>("readonly", (store) => store.getAll() as IDBRequest<GalleryPhoto[]>);
  if (!all) return [];
  return all.sort((a, b) => b.ts - a.ts);
}

/** Hapus satu foto dari galeri perangkat. true = terhapus. */
export async function deletePhoto(id: number): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const transaction = db.transaction(STORE_NAME, "readwrite");
      transaction.objectStore(STORE_NAME).delete(id);
      transaction.oncomplete = () => {
        db.close();
        resolve(true);
      };
      transaction.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
