FROM node:14-alpine
WORKDIR /usr/src/app

COPY package.json yarn.lock ./

RUN yarn install \
 && yarn cache clean

COPY . ./

ENTRYPOINT ["yarn"]
