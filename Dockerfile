FROM node:24-alpine

WORKDIR /home/node/app

COPY package*.json ./

RUN npm i

COPY . .

EXPOSE 3000

RUN addgroup -S geminiadapter && adduser -S geminiadapter -G geminiadapter
USER geminiadapter

CMD [ "node", "server.js" ]