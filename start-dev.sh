#!/bin/bash

echo "🐾 PetFeeder Pro - Development Startup"
echo "======================================"
echo ""

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running. Please start Docker first."
    exit 1
fi

echo "✅ Docker is running"
echo ""

# Start infrastructure
echo "🚀 Starting infrastructure (PostgreSQL, Redis, MQTT)..."
docker-compose up -d postgres redis mosquitto

# Wait for services
echo "⏳ Waiting for services to be ready..."
sleep 5

# Check services
echo ""
echo "📊 Service Status:"
docker-compose ps

echo ""
echo "🔧 Backend Setup:"
echo "   cd backend && npm install && npm run dev"
echo ""
echo "🎨 Frontend:"
echo "   python -m http.server 8000"
echo ""
echo "📱 Access:"
echo "   Frontend: http://localhost:8000"
echo "   Backend:  http://localhost:3000"
echo "   WebSocket: ws://localhost:8080"
echo ""
echo "✅ Infrastructure ready!"
