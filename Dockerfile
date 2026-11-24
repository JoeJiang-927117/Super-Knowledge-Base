FROM node:24-slim

WORKDIR /app

ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1

COPY package.json package-lock.json ./
RUN npm ci --omit=optional

COPY . .
RUN npm run build

ENV ZHIXU_HOST=0.0.0.0
ENV ZHIXU_PORT=8787
ENV ZHIXU_ROOT=/data/knowledge-base

VOLUME ["/data/knowledge-base"]
EXPOSE 8787

CMD ["node", "out/main/server.js"]
