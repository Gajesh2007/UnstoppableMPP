FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock ./
RUN apk add --no-cache ca-certificates && bun install --production

FROM oven/bun:1-alpine
WORKDIR /app

RUN apk add --no-cache ca-certificates wget

COPY --from=deps /app/node_modules node_modules/
COPY package.json bunfig.toml tsconfig.json ./
COPY src/ src/

RUN mkdir -p data
VOLUME /app/data

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["bun", "run", "src/index.ts"]
