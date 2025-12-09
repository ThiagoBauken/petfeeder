# PetFeeder SaaS - Single Container (Node.js serves everything)
FROM node:18-alpine

# Install build dependencies
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy backend source
COPY backend/ .

# Copy frontend to public folder (Node.js will serve it)
COPY frontend/ ./public/

# Environment
ENV NODE_ENV=production
ENV PORT=3000

# Create data directory
RUN mkdir -p /app/data /app/logs

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1

# Start server
CMD ["node", "server-dev.js"]
