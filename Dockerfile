FROM node:22-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build

FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=3010

# Install ALL deps (wrangler is a devDep and is needed at runtime to serve the worker).
COPY package*.json ./
RUN npm ci

# Built worker (workerd bundle + generated wrangler.json) and static assets.
COPY --from=builder /app/dist ./dist

EXPOSE 3010

# Serve the built Cloudflare Worker locally via wrangler (workerd).
# The build emits dist/server/wrangler.json pointing at dist/server/index.js
# with assets at dist/client.
CMD ["npx", "wrangler", "dev", "-c", "dist/server/wrangler.json", "--ip", "0.0.0.0", "--port", "3010"]
