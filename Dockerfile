FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production PORT=8787
COPY package.json package-lock.json .npmrc ./
RUN npm ci --omit=dev && npm install --no-save tsx@4
COPY --from=build /app/dist ./dist
COPY server ./server
COPY src ./src
COPY tsconfig*.json ./
EXPOSE 8787
CMD ["npx", "tsx", "server/index.ts"]
