FROM node:25-alpine

WORKDIR /home/node/app

COPY package*.json ./

RUN npm i

COPY . .

EXPOSE 3000

RUN addgroup --system geminiadapter && adduser --system --group geminiadapter
USER coginets

CMD [ "node", "server.js" ]