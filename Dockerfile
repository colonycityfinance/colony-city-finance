FROM node:20-alpine

WORKDIR /app

# Install dependencies
COPY package*.json ./
RUN npm ci

# Copy source code
COPY . .

# Build frontend and server
RUN npm run build

# Expose port
EXPOSE 5000

ENV NODE_ENV=production

CMD ["node", "dist/index.cjs"]
