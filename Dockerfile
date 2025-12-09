# PetFeeder SaaS - Backend Dockerfile (SQLite interno)
FROM node:18-alpine

# Install build dependencies for native modules (sqlite3)
RUN apk add --no-cache python3 make g++ dumb-init

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

WORKDIR /app

# Copy package files
COPY backend/package*.json ./

# Install dependencies
RUN npm ci && npm cache clean --force

# Copy backend source code
COPY backend/ .

# Create necessary directories
RUN mkdir -p /app/logs /app/uploads /app/data && \
    chown -R nodejs:nodejs /app

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000

# Use dumb-init for proper signal handling
ENTRYPOINT ["dumb-init", "--"]

# Start application (usando server-dev.js com SQLite)
CMD ["node", "server-dev.js"]
