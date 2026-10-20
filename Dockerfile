# Builds and runs the hosted demo: twin, Coffee Club and dashboard in one container.
# No secrets or variables are needed. Railway supplies PORT.
FROM node:24-slim
WORKDIR /app
COPY . .
RUN npm ci --no-audit --no-fund \
 && npm run build \
 && npm run build -w @fastforward/web \
 && chown -R node:node /app
ENV NODE_ENV=production
# The demo does not need root.
USER node
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||8080)+'/fidelity/latest.json').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "scripts/start-hosted.mjs", "--run"]
