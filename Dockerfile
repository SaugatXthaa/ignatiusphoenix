FROM node:20-slim
WORKDIR /app
# curl is REQUIRED by the nuvio scrapers that shell out for CF-JA3-friendly
# fetches (kmmovies.cjs, reanime.cjs). node:20-slim ships without it — every
# scraper fetch then died with ENOENT on Render (0 streams) while the dev
# sandbox (curl present) worked. Re-added as a Node-child-https fallback in
# both scrapers; installing curl keeps the primary path intact.
RUN apt-get update && apt-get install -y --no-install-recommends curl && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci --production
COPY . .
EXPOSE 7000
CMD ["node", "src/index.js"]
