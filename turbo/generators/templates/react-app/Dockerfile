# Build from the REPO ROOT, not this directory:
#   docker build -f apps/{{ name }}/Dockerfile -t {{ name }} .
#
# Unlike the server, this one does compile: Vite bundles the app (and any
# workspace packages it imports) into static assets, which nginx then serves.
#
# Config is NOT baked in. The bundle fetches /config.json at boot; the image
# ships a default, and a ConfigMap mounted over it supplies the real values.
# One image serves every environment.

FROM node:24-alpine AS base
WORKDIR /app
# Must match the turbo major version in the root package.json.
RUN npm i -g turbo@2

FROM base AS prune
COPY . .
RUN turbo prune {{ name }} --docker

FROM base AS build
COPY --from=prune /app/out/json/ .
# devDependencies are required here — vite and typescript live there.
RUN npm ci
COPY --from=prune /app/out/full/ .
RUN turbo run build --filter={{ name }}

# nginx-unprivileged, not nginx: runs as UID 101 on port 8080, with the PID file
# and temp paths under /tmp instead of root-owned directories.
FROM nginxinc/nginx-unprivileged:alpine AS runner

USER root
COPY apps/{{ name }}/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/apps/{{ name }}/dist /usr/share/nginx/html
# OpenShift ignores USER and runs an arbitrary UID whose GID is always 0. The
# stock entrypoint scripts rewrite files under /etc/nginx at startup, so that
# tree has to be group-writable.
RUN chgrp -R 0 /etc/nginx /usr/share/nginx/html && \
    chmod -R g=u /etc/nginx /usr/share/nginx/html
USER 101

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=3s --retries=3 CMD \
  wget -q --spider http://127.0.0.1:8080/ || exit 1
