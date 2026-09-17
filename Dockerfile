FROM node:22-alpine

WORKDIR /app

COPY package.json ./
COPY bin ./bin

RUN npm install --global . \
    && npm cache clean --force

EXPOSE 3000

ENTRYPOINT ["subway"]