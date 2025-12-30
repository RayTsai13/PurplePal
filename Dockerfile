# Stage 1: Build
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./
COPY prisma ./prisma/

# Install all dependencies (including devDependencies for build)
RUN npm ci

# Generate Prisma client
RUN npx prisma generate

# Copy source code and config
COPY tsconfig.json ./
COPY src ./src/
COPY config ./config/

# Build TypeScript
RUN npm run build

# Stage 2: Production
FROM node:20-alpine AS runner

WORKDIR /app

# Create non-root user for security
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 purplepal

# Copy package files and install production dependencies only
COPY package*.json ./
RUN npm ci --only=production

# Copy Prisma schema and generate client for production
COPY prisma ./prisma/
RUN npx prisma generate

# Copy built application
COPY --from=builder /app/dist ./dist/
COPY --from=builder /app/config ./config/

# Copy generated Prisma client from builder
COPY --from=builder /app/generated ./generated/

# Set ownership
RUN chown -R purplepal:nodejs /app

# Switch to non-root user
USER purplepal

# Set environment
ENV NODE_ENV=production

# Run migrations and start the application
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
