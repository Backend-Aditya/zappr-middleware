FROM node:22-alpine AS base
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .

FROM base AS production
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "server.js"]
