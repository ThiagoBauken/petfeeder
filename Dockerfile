# PetFeeder — container único: Node.js serve API REST + WebSocket + frontend estático
FROM node:18-alpine

# Dependências de build para compilar o sqlite3 nativo
RUN apk add --no-cache python3 make g++

WORKDIR /app

# Instala apenas dependências de produção (sqlite3 é compilado para o ambiente do container)
COPY backend/package*.json ./
RUN npm install --omit=dev

# Código do backend
COPY backend/ .

# Frontend servido como estático em ./public (ver server.js: publicPath em produção)
COPY frontend/ ./public/

# Usuário não-root + diretório de dados (SQLite persistente)
RUN mkdir -p /app/data \
 && addgroup -S app && adduser -S app -G app \
 && chown -R app:app /app
USER app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/app/data/petfeeder.db

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -q --spider http://localhost:3000/health || exit 1

CMD ["node", "server.js"]
