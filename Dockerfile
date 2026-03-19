FROM oven/bun:1 AS base
WORKDIR /app

# Install dependencies
COPY package.json bun.lock* ./
RUN bun install --frozen-lockfile --production

# Copy source
COPY src/ src/
COPY bunfig.toml tsconfig.json ./

# Create data directory
RUN mkdir -p data

EXPOSE 3000

CMD ["bun", "run", "src/index.ts"]
