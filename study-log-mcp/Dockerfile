ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --registry=https://registry.npmjs.org && npm cache clean --force
COPY src ./src
ENV NODE_ENV=production MCP_HTTP_HOST=0.0.0.0 MCP_HTTP_PORT=3020
USER node
EXPOSE 3020
CMD ["node", "src/http-server.mjs"]
