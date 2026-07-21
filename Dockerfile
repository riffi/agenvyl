FROM node:22-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/connector-contract/package.json ./packages/connector-contract/package.json
COPY packages/runtime-config/package.json ./packages/runtime-config/package.json
COPY packages/supervisor/package.json ./packages/supervisor/package.json
COPY apps/connector/package.json ./apps/connector/package.json
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json ./
COPY scripts/copy-database-migrations.mjs ./scripts/copy-database-migrations.mjs
COPY apps ./apps
COPY packages ./packages

FROM development AS build
RUN npm run build && npm prune --omit=dev

FROM node:22-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/frontend/dist ./apps/frontend/dist
COPY --from=build /app/apps/backend/dist ./apps/backend/dist
COPY --from=build /app/apps/connector/dist ./apps/connector/dist
COPY --from=build /app/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=build /app/packages/contracts/dist ./packages/contracts/dist
COPY --from=build /app/packages/connector-contract/package.json ./packages/connector-contract/package.json
COPY --from=build /app/packages/connector-contract/dist ./packages/connector-contract/dist
COPY --from=build /app/packages/runtime-config/package.json ./packages/runtime-config/package.json
COPY --from=build /app/packages/runtime-config/dist ./packages/runtime-config/dist
USER node
EXPOSE 8791 4310
CMD ["node", "apps/backend/dist/index.js"]
