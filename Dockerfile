FROM node:22-alpine AS development
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/connector-contract/package.json ./packages/connector-contract/package.json
COPY apps/connector/package.json ./apps/connector/package.json
RUN npm ci
COPY tsconfig.json tsconfig.app.json tsconfig.node.json tsconfig.server.json ./
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
COPY --from=build /app/packages/contracts ./packages/contracts
COPY --from=build /app/packages/connector-contract ./packages/connector-contract
USER node
EXPOSE 8791 4310
CMD ["node", "apps/backend/dist/index.js"]
