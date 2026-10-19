FROM node:24-bookworm-slim

ENV NODE_ENV=production
ENV PORT=4173
ENV HOST=0.0.0.0
ENV PARSEN_STORAGE_DIR=/var/lib/parsen
ENV PARSEN_BACKUP_DIR=/backups

WORKDIR /app

COPY package.json ./
COPY server.mjs builder.html control-panel.html login.html index.html .htaccess ./
COPY lib ./lib
COPY scripts ./scripts
COPY assets ./assets

RUN mkdir -p /var/lib/parsen/data /var/lib/parsen/uploads /var/lib/parsen/published /backups \
  && chown -R node:node /app /var/lib/parsen /backups

USER node

EXPOSE 4173
VOLUME ["/var/lib/parsen", "/backups"]

CMD ["node", "server.mjs"]
