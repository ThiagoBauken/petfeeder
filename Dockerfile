# PetFeeder SaaS - Single Container (Backend + Frontend)
FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache python3 make g++ nginx

WORKDIR /app

# Copy backend package files
COPY backend/package*.json ./

# Install dependencies
RUN npm install --production

# Copy backend source
COPY backend/ .

# Copy frontend to nginx
COPY frontend/ /usr/share/nginx/html/

# Create nginx config for API + WebSocket proxy
RUN echo 'server { \
    listen 80; \
    root /usr/share/nginx/html; \
    index login.html index.html; \
    location /health { return 200 "ok"; add_header Content-Type text/plain; } \
    location / { try_files $uri $uri/ /login.html; } \
    location /api/ { proxy_pass http://127.0.0.1:3000/api/; proxy_http_version 1.1; proxy_set_header Host $host; } \
    location /ws { proxy_pass http://127.0.0.1:8081; proxy_http_version 1.1; proxy_set_header Upgrade $http_upgrade; proxy_set_header Connection "upgrade"; proxy_set_header Host $host; } \
}' > /etc/nginx/http.d/default.conf

# Create start script
RUN echo '#!/bin/sh' > /start.sh && \
    echo 'nginx' >> /start.sh && \
    echo 'node server-dev.js' >> /start.sh && \
    chmod +x /start.sh

# Create data directory
RUN mkdir -p /app/data /app/logs

# Expose port
EXPOSE 80

# Health check
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
    CMD wget -q --spider http://localhost/health || exit 1

# Start both services
CMD ["/bin/sh", "/start.sh"]
