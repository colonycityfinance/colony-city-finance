FROM node:20-alpine

WORKDIR /app

# Copy built server bundle and minimal package.json
COPY dist/index.cjs ./
COPY dist/package.json ./

# Install only the one runtime dependency (openai)
RUN npm install --omit=dev

# Copy data file if exists
COPY data.json ./data.json 2>/dev/null || true

EXPOSE 5000

ENV NODE_ENV=production
ENV PORT=5000

CMD ["node", "index.cjs"]
