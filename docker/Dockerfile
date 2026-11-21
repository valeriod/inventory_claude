# syntax=docker/dockerfile:1

# ---- build: install, test-free production build of web (static) + api (bundled) ----
FROM node:24-alpine AS build
WORKDIR /repo
RUN npm install -g pnpm@12.21.0

# Install dependencies first for better layer caching
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/db/package.json packages/db/
COPY packages/shared/package.json packages/shared/
RUN pnpm install --frozen-lockfile

COPY . .
ARG APP_VERSION=0.0.0
RUN APP_VERSION=${APP_VERSION} pnpm build

# The API bundle inlines everything except better-sqlite3 (native, ships prebuilt binaries).
# Install exactly the version pinned in apps/api/package.json into a clean runtime folder.
RUN mkdir /runtime \
	&& node -e "const v=require('./apps/api/package.json').dependencies['better-sqlite3']; \
		require('fs').writeFileSync('/runtime/package.json', JSON.stringify({type:'module',private:true,dependencies:{'better-sqlite3':v}}))" \
	&& cd /runtime && npm install --omit=dev --no-audit --no-fund

# ---- runtime ----
FROM node:24-alpine
ENV NODE_ENV=production \
	HOST=0.0.0.0 \
	PORT=3000 \
	DATABASE_URL=sqlite:///data/inventory.db \
	STATIC_DIR=/app/public
WORKDIR /app

COPY --from=build /runtime/package.json ./
COPY --from=build /runtime/node_modules ./node_modules
COPY --from=build /repo/apps/api/dist ./dist
COPY --from=build /repo/apps/web/build ./public

RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
	CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "--enable-source-maps", "dist/server.js"]
