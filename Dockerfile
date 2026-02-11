FROM node:22-alpine
WORKDIR /usr/src/app

COPY package.json yarn.lock ./

RUN yarn install \
 && yarn cache clean

COPY . ./

ENTRYPOINT ["yarn"]
