import { defineConfig } from "vite";

// Frontend KOTA KITA — di-deploy statis (mis. Cloudflare Pages).
// Server multiplayer berjalan terpisah (Node.js + Colyseus, port 2567).
export default defineConfig({
  server: {
    port: 5173,
  },
  build: {
    target: "es2022",
    // Target perangkat Android kelas menengah: jaga bundle tetap ramping.
    chunkSizeWarningLimit: 1200,
  },
});
