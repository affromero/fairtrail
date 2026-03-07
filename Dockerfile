FROM node:22-alpine AS deps
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json apps/web/
COPY apps/web/prisma ./apps/web/prisma/
RUN npm ci --ignore-scripts
RUN npx prisma generate --schema=apps/web/prisma/schema.prisma

FROM node:22-alpine AS builder
RUN apk add --no-cache libc6-compat openssl
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
ENV NODE_ENV=production
RUN npm run build --workspace=@fairtrail/web

FROM node:22-alpine AS runner
RUN apk add --no-cache libc6-compat openssl chromium
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3002
ENV HOSTNAME="0.0.0.0"
ENV CHROME_PATH=/usr/bin/chromium-browser
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs
WORKDIR /app

# Full node_modules (standalone trace fails in monorepo)
COPY --from=deps --chown=nextjs:nodejs /app/node_modules ./node_modules

# Standalone server + built app
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=builder /app/apps/web/public ./public
COPY --from=builder /app/apps/web/public ./apps/web/public

# Prisma schema + generated client (for migrations in entrypoint)
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/prisma ./apps/web/prisma

COPY --chown=nextjs:nodejs docker-entrypoint.sh ./
RUN chmod +x docker-entrypoint.sh
USER nextjs
EXPOSE 3002
ENTRYPOINT ["./docker-entrypoint.sh"]
