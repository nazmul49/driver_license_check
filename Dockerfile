FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY shared/package.json shared/
COPY server/package.json server/
COPY hosted-page/package.json hosted-page/
RUN npm ci
COPY . .
RUN npm run build -w hosted-page

FROM node:22-bookworm-slim
ENV NODE_ENV=production TZ=UTC
# Fonts are only needed for generating synthetic fixtures; OCR does not need them.
WORKDIR /app
COPY --from=build /app /app
RUN npm prune --omit=dev && chown -R node:node /app/server
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "server"]
