FROM node:24-alpine

WORKDIR /app
COPY package.json ./
COPY server.js ./
COPY public ./public

ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "--use-env-proxy", "server.js"]
