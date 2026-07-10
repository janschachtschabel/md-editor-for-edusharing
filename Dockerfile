# Collaborative markdown editor for edu-sharing — all-in-one deployment
# (frontend + collab server in one container).
# Multi-stage (audit D-1): the build stage needs devDependencies (esbuild),
# the final image installs runtime deps only.
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY src ./src
COPY public ./public
RUN npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY server.js ./
COPY server ./server
# src stays in the image: the server imports shared modules from it
# (markdown/extensions/entity-types) at runtime
COPY src ./src
COPY --from=build /app/public ./public
ENV PORT=3000
EXPOSE 3000
# Run as the unprivileged built-in "node" user, not root (audit D-01)
USER node
# Liveness probe (audit F-09)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
