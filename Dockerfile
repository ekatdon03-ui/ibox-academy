# iBOX Academy — Node + Express (serves built SPA). Used for Timeweb Cloud Apps.
FROM node:22-bookworm-slim

WORKDIR /app

# ca-certificates for outbound HTTPS (S3, Firebase, Gemini)
RUN apt-get update \
  && apt-get install -y --no-install-recommends ca-certificates \
  && rm -rf /var/lib/apt/lists/*

# Install deps (incl. dev — needed for the build step)
COPY package*.json ./
RUN npm install

# Build frontend (vite) + backend bundle (esbuild)
COPY . .
RUN npm run build

ENV NODE_ENV=production
# Timeweb injects PORT; server falls back to 3000
EXPOSE 3000

CMD ["node", "dist/server.cjs"]
