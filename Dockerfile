# Collaborative markdown editor for edu-sharing — all-in-one deployment
# (frontend + collab server in one container).
FROM node:22-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY server.js ./
COPY server ./server
COPY src ./src
COPY public ./public
RUN npm run build
ENV PORT=3000
EXPOSE 3000
# Run as the unprivileged built-in "node" user, not root (audit D-01)
USER node
# Liveness probe (audit F-09)
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server.js"]
