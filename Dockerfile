# Pulse brain image. Playwright's base image bundles Chromium + all its OS deps
# and Node 20, so the server-side browser agent runs without extra setup. The
# image version MUST match the `playwright` npm version in server/package.json.
# Build context is the repo root so both server/ (the app) and site/ (the page)
# are included.
FROM mcr.microsoft.com/playwright:v1.49.1-jammy
WORKDIR /app

COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci

COPY server ./server
COPY site ./site
RUN cd server && npm run build

ENV PORT=8080
# Browsers are pre-installed in the base image; point Playwright at them.
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright
EXPOSE 8080
CMD ["node", "server/dist/src/server.js"]
