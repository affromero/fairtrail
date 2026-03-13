FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/web/prisma ./apps/web/prisma/
RUN npm ci
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

# Production-only deps (no devDependencies)
FROM node:22-alpine AS proddeps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/web/prisma ./apps/web/prisma/
RUN npm ci --omit=dev
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ARG COMMIT_SHA=unknown
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
ENV NEXT_PUBLIC_COMMIT_SHA=${COMMIT_SHA}
RUN npm run build --workspace=@fairtrail/web

FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl chromium
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3003
ENV HOSTNAME="0.0.0.0"
ENV CHROME_PATH=/usr/bin/chromium-browser

# CLI provider support: writable npm global prefix for node user
RUN mkdir -p /home/node/.npm-global /home/node/.claude /home/node/.codex && \
    chown -R node:node /home/node/.npm-global /home/node/.claude /home/node/.codex
ENV NPM_CONFIG_PREFIX=/home/node/.npm-global
ENV PATH="/home/node/.npm-global/bin:$PATH"

WORKDIR /app

# Standalone server (includes traced node_modules)
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/public ./apps/web/public

# Prisma schema + generated client (for migrations in entrypoint)
COPY --from=builder --chown=node:node /app/apps/web/prisma ./apps/web/prisma
COPY --from=proddeps --chown=node:node /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=proddeps --chown=node:node /app/node_modules/@prisma ./node_modules/@prisma

# Runtime packages that standalone trace misses (dynamic imports in cron callbacks)
COPY --from=proddeps --chown=node:node /app/node_modules/ioredis ./node_modules/ioredis
COPY --from=proddeps --chown=node:node /app/node_modules/@ioredis ./node_modules/@ioredis
COPY --from=proddeps --chown=node:node /app/node_modules/redis-parser ./node_modules/redis-parser
COPY --from=proddeps --chown=node:node /app/node_modules/redis-errors ./node_modules/redis-errors
COPY --from=proddeps --chown=node:node /app/node_modules/denque ./node_modules/denque
COPY --from=proddeps --chown=node:node /app/node_modules/standard-as-callback ./node_modules/standard-as-callback
COPY --from=proddeps --chown=node:node /app/node_modules/cluster-key-slot ./node_modules/cluster-key-slot
COPY --from=proddeps --chown=node:node /app/node_modules/lodash.defaults ./node_modules/lodash.defaults
COPY --from=proddeps --chown=node:node /app/node_modules/lodash.isarguments ./node_modules/lodash.isarguments
COPY --from=proddeps --chown=node:node /app/node_modules/debug ./node_modules/debug
COPY --from=proddeps --chown=node:node /app/node_modules/ms ./node_modules/ms
COPY --from=proddeps --chown=node:node /app/node_modules/ua-parser-js ./node_modules/ua-parser-js
COPY --from=proddeps --chown=node:node /app/node_modules/@anthropic-ai ./node_modules/@anthropic-ai
COPY --from=proddeps --chown=node:node /app/node_modules/json-schema-to-ts ./node_modules/json-schema-to-ts
COPY --from=proddeps --chown=node:node /app/node_modules/@babel/runtime ./node_modules/@babel/runtime
COPY --from=proddeps --chown=node:node /app/node_modules/ts-algebra ./node_modules/ts-algebra
COPY --from=proddeps --chown=node:node /app/node_modules/openai ./node_modules/openai
COPY --from=proddeps --chown=node:node /app/node_modules/@google ./node_modules/@google

RUN mkdir -p /app/data && chown node:node /app/data

COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3003
ENTRYPOINT ["./docker-entrypoint.sh"]
