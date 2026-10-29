ARG EMBEDDED_JAVA_VERSION=21
ARG BUILDPLATFORM=linux/amd64

FROM --platform=${BUILDPLATFORM} node:24.22.2-alpine3.23@sha256:9b69af715c7f9d038150b54ccccbaeffa9064bbc93e2904c29591ca097316af1 AS builder

WORKDIR /src
RUN apk add --no-cache wget

# 1) Dependency manifests only — this install layer stays cached across rebuilds
#    as long as the package*.json files don't change, so a source-only change no
#    longer re-installs node_modules. Only common + daemon are needed for this
#    image (panel/frontend belong to the web image).
COPY common/package*.json ./common/
COPY daemon/package*.json ./daemon/
RUN npm ci --prefix common --ignore-scripts --no-audit --no-fund &&\
    npm ci --prefix daemon --ignore-scripts --no-audit --no-fund

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
# Official glibc build; match the Temurin runtime platform.
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends ca-certificates curl xz-utils libstdc++6 libatomic1; \
    case "$(dpkg --print-architecture)" in \
      amd64) node_arch=x64; node_sha=48cc0e21e048790e54c0cf5749c2725005313d652651c40b7a21feb9697aaf75 ;; \
      arm64) node_arch=arm64; node_sha=eb187837a2230d4047161ac0be008584e16b46f726e9c9490ee35dc6b17d9ba8 ;; \
      *) echo "Unsupported Node architecture" >&2; exit 1 ;; \
    esac; \
    curl -fsSLo /tmp/node.tar.xz "https://nodejs.org/download/release/v24.22.2/node-v24.22.2-linux-$node_arch.tar.xz"; \
    echo "$node_sha  /tmp/node.tar.xz" | sha256sum -c -; \
    tar -xJf /tmp/node.tar.xz --strip-components=1 -C /usr/local; \
    rm /tmp/node.tar.xz; \
    test "$(node --version)" = v24.22.2; \
    test "$(npm --version)" = 11.19.1; \
    java -version; \
    if ldd /usr/local/bin/node | grep -q "not found"; then exit 1; fi; \
    apt-get clean; \
    rm -rf /var/lib/apt/lists/*

WORKDIR /opt/mcsmanager/daemon

# Install runtime deps first (cached unless package*.json changes) so a code-only
# change doesn't re-run the production npm ci.
# Preserve the actual target of the file:../common dependency.
COPY --from=builder /src/common/package*.json /opt/mcsmanager/common/
COPY --from=builder /src/common/src/ /opt/mcsmanager/common/src/
COPY --from=builder /src/common/global.d.ts /opt/mcsmanager/common/
COPY --from=builder /src/common/tsconfig.json /opt/mcsmanager/common/
COPY --from=builder /src/production-code/daemon/package*.json ./
RUN npm ci --prefix /opt/mcsmanager/common --omit=dev --ignore-scripts --no-audit --no-fund &&\
    npm ci --omit=dev --ignore-scripts --no-audit --no-fund &&\
    test "$(readlink -f node_modules/mcsmanager-common)" = /opt/mcsmanager/common

COPY --from=builder /src/production-code/daemon/ /opt/mcsmanager/daemon/

EXPOSE 24444

ENV MCSM_INSTANCES_BASE_PATH=/opt/mcsmanager/daemon/data/InstanceData

VOLUME ["/opt/mcsmanager/daemon/data", "/opt/mcsmanager/daemon/logs"]

CMD [ "node", "--max-old-space-size=8192", "app.js" ]
