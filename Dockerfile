FROM oven/bun:1-alpine AS deps
WORKDIR /app
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

FROM oven/bun:1-alpine
WORKDIR /app

# Non-root user
RUN addgroup -S mpp && adduser -S mpp -G mpp

# Copy deps and source
COPY --from=deps /app/node_modules node_modules/
COPY package.json bunfig.toml tsconfig.json ./
COPY src/ src/

# Data directory with correct permissions
RUN mkdir -p data && chown -R mpp:mpp /app

USER mpp

EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://localhost:3000/ || exit 1

CMD ["bun", "run", "src/index.ts"]
