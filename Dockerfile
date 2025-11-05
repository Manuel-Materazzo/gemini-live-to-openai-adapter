FROM node:22

WORKDIR /home/node/app

COPY package*.json ./

RUN npm i

COPY . .

ENV NODE_PATH=./build

RUN npm run build

EXPOSE 3000
CMD [ "node", "index.js" ]