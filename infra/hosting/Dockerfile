FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json ./apps/api/package.json
COPY apps/web/package.json ./apps/web/package.json
COPY packages/contracts/package.json ./packages/contracts/package.json
RUN npm ci --no-audit --no-fund
COPY tsconfig*.json ./
COPY apps ./apps
COPY packages ./packages
COPY db ./db
ENV NEXT_TELEMETRY_DISABLED=1
# Next.js rewrites are resolved at build time. Both processes run in the same task/container.
ENV API_INTERNAL_URL=http://127.0.0.1:4000
RUN npm run build --workspace apps/api && npm run build --workspace apps/web

FROM node:22-bookworm-slim AS runtime
RUN apt-get update && apt-get install -y --no-install-recommends nginx ca-certificates curl \
    && curl --fail --silent --show-error --output /etc/ssl/certs/rds-global-bundle.pem \
       https://truststore.pki.rds.amazonaws.com/global/global-bundle.pem \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build --chown=node:node /app /app
COPY --chown=node:node infra/hosting/entrypoint.mjs /app/infra/hosting/entrypoint.mjs
COPY --chown=node:node infra/hosting/migrate.mjs /app/infra/hosting/migrate.mjs
COPY --chown=node:node infra/hosting/verify.mjs /app/infra/hosting/verify.mjs
COPY infra/hosting/nginx.conf /etc/nginx/nginx.conf
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 \
    API_INTERNAL_URL=http://127.0.0.1:4000 \
    NODE_EXTRA_CA_CERTS=/etc/ssl/certs/rds-global-bundle.pem
USER node
EXPOSE 8080
STOPSIGNAL SIGTERM
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:8080/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
ENTRYPOINT ["node", "/app/infra/hosting/entrypoint.mjs"]
CMD ["app"]
