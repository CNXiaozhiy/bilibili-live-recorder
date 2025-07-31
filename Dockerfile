FROM node:22-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --prefer-offline
COPY . .
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production

RUN apk add --no-cache ffmpeg && \
    addgroup -S appgroup && \
    adduser -S appuser -G appgroup && \
    mkdir -p /app/config && \
    chown -R appuser:appgroup /app

ENV FFMPEG_BIN_FOLDER="/usr/bin"
ENV ENV_FILE_FLODER="/app/config"

COPY --from=builder --chown=appuser:appgroup /app/package.json /app/package-lock.json ./
COPY --from=builder --chown=appuser:appgroup /app/dist ./dist

RUN npm ci --omit=dev --no-audit --prefer-offline

USER appuser
CMD ["npm", "run", "prod"]