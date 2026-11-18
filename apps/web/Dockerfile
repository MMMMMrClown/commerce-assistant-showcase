FROM node:24-bookworm-slim AS build

ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable \
    && corepack prepare pnpm@11.20.0 --activate

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
RUN --mount=type=cache,id=sunny-coffee-pnpm,target=/pnpm/store \
    pnpm install --filter web... --frozen-lockfile \
      --fetch-retries=5 \
      --fetch-timeout=300000

COPY apps/web apps/web
RUN pnpm --filter web build

FROM node:24-bookworm-slim AS runtime

ENV NODE_ENV=production
ENV PORT=5173
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH

WORKDIR /app

RUN corepack enable \
    && corepack prepare pnpm@11.20.0 --activate

COPY --from=build --chown=node:node /app/package.json /app/pnpm-lock.yaml /app/pnpm-workspace.yaml ./
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/apps/web ./apps/web

USER node
EXPOSE 5173

CMD ["node", "apps/web/node_modules/next/dist/bin/next", "start", "apps/web", "-p", "5173"]
