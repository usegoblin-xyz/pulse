# Pulse brain image. Build context is the repo root so both server/ (the app)
# and site/ (the landing page it serves) are included.
FROM node:20-slim
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY server ./server
COPY site ./site
RUN cd server && npm run build

ENV PORT=8080
EXPOSE 8080
CMD ["node", "server/dist/src/server.js"]
