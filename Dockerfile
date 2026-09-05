# syntax=docker/dockerfile:1

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM node:22-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Runtime dependencies installed separately: npm prune does not reliably drop
# transitive devDependencies, and shipping them re-introduces scanner findings.
# Runtime dependencies only: prisma lives in dependencies, so the postinstall
# (prisma generate) runs with a CLI whose version always matches @prisma/client,
# including the engine binaries that --ignore-scripts would have skipped.
FROM node:22-alpine AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

FROM node:22-alpine AS runner
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
USER app
EXPOSE 3000
CMD ["node", "--enable-source-maps", "dist/main.js"]
