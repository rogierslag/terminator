FROM node:18-alpine
MAINTAINER Rogier Slag

EXPOSE 8543

WORKDIR /opt/terminator
# Set the config volume
VOLUME /opt/terminator/config

# Set the application
COPY .babelrc .
COPY .eslintrc.js .
COPY package.json .
COPY yarn.lock .
RUN yarn install --frozen-lockfile
COPY src ./src

RUN yarn build

# Start it!
CMD ["node", "out/server.js"]

