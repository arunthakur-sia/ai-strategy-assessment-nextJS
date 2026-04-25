# ============================================================
# Stage 1: Build frontend
# ============================================================
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend
COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ ./
# Accepts build-time arg so CI can inject the API URL
ARG VITE_API_URL=/api
ENV VITE_API_URL=$VITE_API_URL

RUN npm run build

# ============================================================
# Stage 2: Build backend
# ============================================================
FROM node:20-alpine AS backend-builder

WORKDIR /app/backend
COPY backend/package*.json ./
RUN npm ci

COPY backend/ ./
RUN npm run build

# ============================================================
# Stage 3: Production image
# ============================================================
FROM node:20-alpine AS production

WORKDIR /app

# Install only production deps
COPY backend/package*.json ./
RUN npm ci --omit=dev

# Copy compiled backend
COPY --from=backend-builder /app/backend/dist ./dist

# Copy frontend build into backend's public folder so Express serves it
COPY --from=frontend-builder /app/frontend/dist ./dist/public

# Expose port
EXPOSE 3000

# Runtime env vars (override via -e or docker-compose)
ENV NODE_ENV=production \
    PORT=3000

# Run migrations then start
CMD ["node", "--experimental-specifier-resolution=node", "dist/index.js"]
