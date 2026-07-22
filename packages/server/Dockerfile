# ---- Build stage: compile shared + server to JS ----
FROM node:20-alpine AS build
WORKDIR /app

# Copy manifests first for better layer caching.
COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json

# Install the whole workspace (dev deps needed to compile TypeScript).
RUN npm install --no-audit --no-fund

# Copy sources and build shared -> server.
COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
RUN npm run build --workspace @mimic/shared \
 && npm run build --workspace @mimic/server

# ---- Runtime stage: prod deps only ----
FROM node:20-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json* ./
COPY packages/shared/package.json packages/shared/package.json
COPY packages/server/package.json packages/server/package.json
COPY packages/client/package.json packages/client/package.json
RUN npm install --omit=dev --no-audit --no-fund

# Compiled output only.
COPY --from=build /app/packages/shared/dist packages/shared/dist
COPY --from=build /app/packages/server/dist packages/server/dist

EXPOSE 2567
# Basic healthcheck hitting the Express /health endpoint.
HEALTHCHECK --interval=30s --timeout=4s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||2567)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "packages/server/dist/index.js"]
