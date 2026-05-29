ARG BUILDPLATFORM=linux/amd64
FROM --platform=${BUILDPLATFORM} node:lts-alpine AS builder

WORKDIR /src

# 1) Dependency manifests only — install layer stays cached across rebuilds when
#    package*.json files are unchanged. Only common + panel + frontend are needed
#    for this image (the daemon belongs to the daemon image).
COPY common/package*.json ./common/
COPY panel/package*.json ./panel/
COPY frontend/package*.json ./frontend/
RUN npm install --prefix common --no-audit --no-fund &&\
    npm install --prefix panel --no-audit --no-fund &&\
    npm install --prefix frontend --no-audit --no-fund

# 2) Source (node_modules excluded via .dockerignore, so cached installs persist).
COPY common/ ./common/
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

FROM node:lts-alpine

WORKDIR /opt/mcsmanager/web

# Install runtime deps first (cached unless package*.json changes) so a code-only
# change doesn't re-run the production npm install.
COPY --from=builder /src/production-code/web/package*.json ./
RUN npm install --production

COPY --from=builder /src/production-code/web/ /opt/mcsmanager/web/

EXPOSE 23333

VOLUME ["/opt/mcsmanager/web/data", "/opt/mcsmanager/web/logs"]

CMD [ "app.js", "--max-old-space-size=8192" ]
