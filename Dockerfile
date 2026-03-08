FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl python3 make g++
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/web/prisma ./apps/web/prisma/
RUN npm ci
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
RUN npm install -g @anthropic-ai/claude-code
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3003
ENV HOSTNAME="0.0.0.0"
ENV CHROME_PATH=/usr/bin/chromium-browser
# Reuse the existing node user (UID 1000) to match host sotto user for .claude mount
RUN mkdir -p /home/node/.claude && chown node:node /home/node/.claude
WORKDIR /app

# Full node_modules (standalone trace fails in monorepo)
COPY --from=deps --chown=node:node /app/node_modules ./node_modules

# Standalone server + built app
COPY --from=builder --chown=node:node /app/apps/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=node:node /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/public ./apps/web/public

# Prisma schema + generated client (for migrations in entrypoint)
COPY --from=builder --chown=node:node /app/apps/web/prisma ./apps/web/prisma

RUN mkdir -p /app/data && chown node:node /app/data

COPY --chown=node:node docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER node
EXPOSE 3003
ENTRYPOINT ["./docker-entrypoint.sh"]
