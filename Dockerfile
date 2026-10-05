# syntax=docker/dockerfile:1
ARG NODE_IMAGE=node:22-alpine@sha256:0a7108bf6c7bf5de370ffb1a3ed6be93d405b43ff159f681a8d18c0e2bc2e402

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci

FROM ${NODE_IMAGE} AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# Runtime dependencies installed separately: npm prune does not reliably drop
# transitive devDependencies, and shipping them re-introduces scanner findings.
# Runtime dependencies only: prisma lives in dependencies, so the postinstall
# (prisma generate) runs with a CLI whose version always matches @prisma/client,
# including the engine binaries that --ignore-scripts would have skipped.
FROM ${NODE_IMAGE} AS prod-deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev

FROM ${NODE_IMAGE} AS runner
ARG GIT_SHA
ENV BUILD_SHA=${GIT_SHA}
ENV NODE_ENV=production
WORKDIR /app
RUN addgroup -S app && adduser -S app -G app
COPY --from=prod-deps --chown=app:app /app/node_modules ./node_modules
COPY --from=build --chown=app:app /app/dist ./dist
COPY --from=build --chown=app:app /app/prisma ./prisma
COPY --from=build --chown=app:app /app/package.json ./package.json
COPY --from=build --chown=app:app /app/scripts/docker-entrypoint.sh ./docker-entrypoint.sh
USER app
EXPOSE 3000
CMD ["sh", "./docker-entrypoint.sh"]
