FROM node:22-bookworm-slim AS base

ENV PUPPETEER_SKIP_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates \
    chromium \
    ffmpeg \
    git \
    openssh-client \
    python3 \
    python3-venv \
    python3-pip \
    tini \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build \
  && npm install -g @anthropic-ai/claude-code \
  && npm prune --omit=dev

ENV NODE_ENV=production

EXPOSE 3141

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
