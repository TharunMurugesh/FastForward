# Builds and runs the hosted demo: twin, Coffee Club and dashboard in one container.
# No secrets or variables are needed. Railway supplies PORT.
FROM node:24-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && npm run build -w @fastforward/web
ENV NODE_ENV=production
EXPOSE 8080
CMD ["node", "scripts/start-hosted.mjs", "--run"]
