FROM node:25

WORKDIR /home/node/app

COPY package*.json ./

RUN npm i

COPY . .

EXPOSE 3000
CMD [ "node", "server.js" ]