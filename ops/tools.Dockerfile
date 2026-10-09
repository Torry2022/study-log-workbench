ARG NODE_IMAGE=node:22-bookworm-slim
FROM ${NODE_IMAGE}
WORKDIR /app
COPY --chown=node:node ops/instance.mjs ops/welcome-log.md ops/archive.mjs ops/archive-cli.mjs ./ops/
COPY --chown=node:node prompts ./prompts
USER node
ENTRYPOINT ["node"]
CMD ["ops/instance.mjs"]
