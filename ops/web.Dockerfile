ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE} AS dependencies
WORKDIR /build/study-log-web
COPY study-log-web/package.json study-log-web/package-lock.json ./
RUN npm ci --include=dev --registry=https://registry.npmjs.org

FROM dependencies AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY study-log-web/ ./
RUN npm run build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 HOSTNAME=0.0.0.0 PORT=3000
COPY --from=builder --chown=node:node /build/study-log-web/.next-build-cache/standalone ./study-log-web
COPY --from=builder --chown=node:node /build/study-log-web/.next-build-cache/static ./study-log-web/.next-build-cache/static
COPY --from=builder --chown=node:node /build/study-log-web/public ./study-log-web/public
COPY --chown=node:node ops/instance.mjs ops/welcome-log.md ops/service.mjs ops/serve.mjs ./ops/
COPY --chown=node:node prompts ./prompts
USER node
EXPOSE 3000
CMD ["node", "ops/serve.mjs", "study-log-web/server.js"]
