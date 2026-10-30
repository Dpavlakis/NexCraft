ARG BUILDPLATFORM=linux/amd64
FROM --platform=${BUILDPLATFORM} node:24.22.2-alpine3.23@sha256:9b69af715c7f9d038150b54ccccbaeffa9064bbc93e2904c29591ca097316af1 AS builder

WORKDIR /src

# 1) Dependency manifests only — install layer stays cached across rebuilds when
#    package*.json files are unchanged.
#    Root deps (e.g. async-mutex) resolve from /src/node_modules, and the panel
#    bundles some daemon source (settings_router -> daemon system_file), so the
#    daemon must be installed/present here too — but it is NOT webpack-built.
COPY package*.json ./
COPY common/package*.json ./common/
COPY daemon/package*.json ./daemon/
COPY panel/package*.json ./panel/
COPY frontend/package*.json ./frontend/
RUN npm ci --ignore-scripts --no-audit --no-fund &&\
    npm ci --prefix common --ignore-scripts --no-audit --no-fund &&\
    npm ci --prefix daemon --ignore-scripts --no-audit --no-fund &&\
    npm ci --prefix panel --ignore-scripts --no-audit --no-fund &&\
    npm ci --prefix frontend --ignore-scripts --no-audit --no-fund

# 2) Source (node_modules excluded via .dockerignore, so cached installs persist).
COPY common/ ./common/
COPY daemon/ ./daemon/
COPY panel/ ./panel/
COPY frontend/ ./frontend/
COPY languages/ ./languages/

# 3) Build the panel (webpack) and frontend (vite). Panel inlines common from
#    ../common/src via its alias, so common needs no separate tsc build.
RUN npm run build --prefix panel &&\
    npm run build --prefix frontend

# 4) Assemble the production payload.
RUN mkdir -p production-code/web/public &&\
    cp panel/production/app.js panel/production/app.js.map production-code/web/ &&\
    cp panel/package.json panel/package-lock.json production-code/web/ &&\
    cp -r frontend/dist/. production-code/web/public/

FROM node:24.22.2-alpine3.23@sha256:9b69af715c7f9d038150b54ccccbaeffa9064bbc93e2904c29591ca097316af1

WORKDIR /opt/mcsmanager/web

# Install runtime deps first (cached unless package*.json changes) so a code-only
# change doesn't re-run the production npm ci.
# Preserve the actual target of the file:../common dependency.
COPY --from=builder /src/common/package*.json /opt/mcsmanager/common/
COPY --from=builder /src/common/src/ /opt/mcsmanager/common/src/
COPY --from=builder /src/common/global.d.ts /opt/mcsmanager/common/
COPY --from=builder /src/common/tsconfig.json /opt/mcsmanager/common/
COPY --from=builder /src/production-code/web/package*.json ./
RUN npm ci --prefix /opt/mcsmanager/common --omit=dev --ignore-scripts --no-audit --no-fund &&\
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund &&\
    test "$(readlink -f node_modules/mcsmanager-common)" = /opt/mcsmanager/common

COPY --from=builder /src/production-code/web/ /opt/mcsmanager/web/

EXPOSE 23333

VOLUME ["/opt/mcsmanager/web/data", "/opt/mcsmanager/web/logs"]

CMD [ "node", "--max-old-space-size=8192", "app.js" ]
