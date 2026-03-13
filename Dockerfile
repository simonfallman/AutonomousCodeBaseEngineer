FROM node:22-alpine

WORKDIR /app

COPY package*.json ./
RUN npm ci --only=production

COPY tsconfig.json ./
COPY src ./src
RUN npm install -D typescript && npx tsc && npm uninstall typescript

ENV MCP_TRANSPORT=sse
ENV PORT=3001
ENV NODE_ENV=production

EXPOSE 3001

CMD ["node", "dist/index.js"]
