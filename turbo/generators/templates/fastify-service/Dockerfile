# Build from the REPO ROOT, not this directory:
#   docker build -f apps/{{ name }}/Dockerfile -t {{ name }} .
#
# There is no compile step. Node 24 strips TypeScript types at load, and the
# workspace packages are symlinked out of node_modules, so their real paths sit
# under /app/packages — outside node_modules, where stripping is allowed.

FROM node:24-alpine AS base
WORKDIR /app
# Must match the turbo major version in the root package.json.
RUN npm i -g turbo@2

# Reduce the monorepo to just what `{{ name }}` needs, splitting manifests from
# source so the install layer only busts when a package.json changes.
FROM base AS prune
COPY . .
RUN turbo prune {{ name }} --docker

FROM base AS install
COPY --from=prune /app/out/json/ .
RUN npm ci --omit=dev
COPY --from=prune /app/out/full/ .

FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
# `.env` never ships, so without this the service would fall back to the PORT default in
# @repo/fastify-base (8080) and disagree with EXPOSE and the healthcheck below. Still overridable
# at runtime.
ENV PORT={{ port }}
RUN addgroup -S -g 1001 nodejs && adduser -S -u 1001 -G nodejs fastify
COPY --from=install --chown=fastify:nodejs /app .
# OpenShift ignores USER and runs an arbitrary UID whose GID is always 0, so
# everything the process reads has to be accessible to the root group.
RUN chgrp -R 0 /app && chmod -R g=u /app
# Numeric, not a name: `runAsNonRoot` admission checks cannot resolve names.
# OpenShift overrides this anyway; it is what keeps plain Docker and CI non-root.
USER 1001

EXPOSE {{ port }}

# Liveness only — readiness is the orchestrator's business, and restarting a
# container because a database blipped is how one outage becomes a restart storm.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 CMD \
  node -e "fetch('http://127.0.0.1:'+(process.env.PORT||{{ port }})+'/livez').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

# Exec form, so the process is PID 1 and receives SIGTERM directly —
# close-with-grace needs that signal to drain connections.
CMD ["node", "apps/{{ name }}/src/index.ts"]
