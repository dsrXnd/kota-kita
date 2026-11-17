# KOTA KITA — satu wadah (container) berisi website + server game.
# Dipakai oleh Render / Railway / Fly.io / VPS apa pun yang mendukung Docker.

# ---------- Tahap build ----------
FROM node:22-alpine AS build
WORKDIR /app
COPY client/package.json client/package-lock.json client/
COPY server/package.json server/package-lock.json server/
RUN cd client && npm ci --no-audit --no-fund
RUN cd server && npm ci --no-audit --no-fund
COPY client client
COPY server server
RUN cd client && npm run build
RUN cd server && npm run build

# ---------- Tahap jalan ----------
FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
ENV CLIENT_DIST=/app/client/dist
ENV KOTA_DATA_DIR=/app/data
COPY --from=build /app/client/dist client/dist
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/server/node_modules server/node_modules
COPY --from=build /app/server/package.json server/package.json
# Folder data akun/log — di hosting gratis folder ini bisa ter-reset saat
# deploy ulang; pasang persistent disk berbayar bila akun pemain sudah ramai.
VOLUME ["/app/data"]
EXPOSE 2567
CMD ["node", "server/dist/index.js"]
