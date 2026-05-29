ARG EMBEDDED_JAVA_VERSION=21
ARG BUILDPLATFORM=linux/amd64

FROM --platform=${BUILDPLATFORM} node:lts-alpine AS builder

WORKDIR /src
RUN apk add --no-cache wget

# 1) Dependency manifests only — this install layer stays cached across rebuilds
#    as long as the package*.json files don't change, so a source-only change no
#    longer re-installs node_modules. Only common + daemon are needed for this
#    image (panel/frontend belong to the web image).
COPY common/package*.json ./common/
COPY daemon/package*.json ./daemon/
RUN npm install --prefix common --no-audit --no-fund &&\
    npm install --prefix daemon --no-audit --no-fund

# 2) Source. node_modules is excluded via .dockerignore, so the cached installs
#    above are preserved (COPY merges, it doesn't delete existing files).
COPY common/ ./common/
COPY daemon/ ./daemon/
COPY languages/ ./languages/
COPY lib-urls.txt ./

# 3) Bundle the daemon (webpack inlines common from ../common/src via its alias,
#    so common does not need a separate tsc build).
RUN npm run build --prefix daemon

# 4) Assemble the production payload. Runtime deps are installed in the final
#    stage so native modules are built for the runtime platform (temurin), not
#    the alpine builder.
RUN mkdir -p production-code/daemon/lib &&\
    cp daemon/production/app.js daemon/production/app.js.map production-code/daemon/ &&\
    cp daemon/package.json daemon/package-lock.json production-code/daemon/ &&\
    wget --input-file=lib-urls.txt --directory-prefix=production-code/daemon/lib/ &&\
    chmod a+x production-code/daemon/lib/*

FROM eclipse-temurin:${EMBEDDED_JAVA_VERSION}-jdk

ARG DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y curl &&\
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash &&\
    apt-get update && apt-get install -y nodejs && apt-get clean

WORKDIR /opt/mcsmanager/daemon

# Install runtime deps first (cached unless package*.json changes) so a code-only
# change doesn't re-run the production npm install.
COPY --from=builder /src/production-code/daemon/package*.json ./
RUN npm install --production

COPY --from=builder /src/production-code/daemon/ /opt/mcsmanager/daemon/

EXPOSE 24444

ENV MCSM_INSTANCES_BASE_PATH=/opt/mcsmanager/daemon/data/InstanceData

VOLUME ["/opt/mcsmanager/daemon/data", "/opt/mcsmanager/daemon/logs"]

CMD [ "node", "app.js", "--max-old-space-size=8192" ]
