FROM oven/bun:1.2.15-alpine

WORKDIR /app

ENV NODE_ENV=production

COPY package.json ./
RUN bun install --production

COPY . .

USER bun

CMD ["bun", "index.js"]
