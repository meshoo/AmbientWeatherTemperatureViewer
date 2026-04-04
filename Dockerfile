FROM node:20-alpine

WORKDIR /app

# Install build deps for better-sqlite3 native addon
RUN apk add --no-cache python3 make g++

# Install dependencies first (layer cache optimization)
COPY package.json package-lock.json* ./
RUN npm ci --only=production

# Copy application source
COPY src/ ./src/
COPY views/ ./views/
COPY public/ ./public/
COPY server.js ./

# Runtime data directory (mounted as Docker volume)
RUN mkdir -p /app/data

# Non-root user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup \
    && chown -R appuser:appgroup /app
USER appuser

EXPOSE 3000

HEALTHCHECK --interval=60s --timeout=10s --start-period=30s --retries=3 \
  CMD wget -qO- http://localhost:3000/api/admin/status || exit 1

CMD ["node", "server.js"]
