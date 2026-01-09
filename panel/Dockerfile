# Dockerfile for MetaSal Panel
FROM node:20-alpine

WORKDIR /app

# OpenSSL ve Prisma için gerekli kütüphaneler
RUN apk add --no-cache openssl openssl-dev libc6-compat

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy prisma schema
COPY prisma ./prisma

# Generate Prisma client
RUN npx prisma generate

# Copy source code
COPY . .

# Expose port
EXPOSE 3000

# Start command (önce db push, sonra start)
CMD ["sh", "-c", "npx prisma db push --skip-generate && npm start"]
