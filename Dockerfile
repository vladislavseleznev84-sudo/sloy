FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server ./server
COPY web ./web
COPY scripts ./scripts
ENV PORT=3000 DB_PATH=/data/sloy.db
VOLUME /data
EXPOSE 3000
CMD ["node", "server/index.js"]
