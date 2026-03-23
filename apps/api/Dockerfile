FROM node:20-alpine AS builder

WORKDIR /app

RUN apk add --no-cache openssl

# Package files
COPY package.json ./
COPY tsconfig.base.json ./
COPY apps/api/package.json ./apps/api/
COPY apps/api/tsconfig.json ./apps/api/

# Shared types (two locations to satisfy relative import paths)
COPY packages/shared/ ./packages/shared/
COPY packages/shared/ ./apps/packages/shared/

# Prisma schema
COPY prisma/ ./prisma/

# Install dependencies
WORKDIR /app/apps/api
RUN npm install

# Source
WORKDIR /app
COPY apps/api/src/ ./apps/api/src/

# Generate Prisma client
WORKDIR /app/apps/api
RUN npx prisma generate --schema=../../prisma/schema.prisma

# Compile TypeScript
RUN npx tsc || true

# ── Production image ──
FROM node:20-alpine AS runner

WORKDIR /app

RUN apk add --no-cache dumb-init openssl

ENV NODE_ENV=production

COPY apps/api/package.json ./
RUN npm install --omit=dev

COPY --from=builder /app/apps/api/dist ./dist
COPY --from=builder /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/apps/api/src/workflows ./dist/apps/api/src/workflows

RUN mkdir -p /app/logs

RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 api
USER api

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:4000/health', (r) => process.exit(r.statusCode === 200 ? 0 : 1))"

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/apps/api/src/index.js"]

