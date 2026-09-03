FROM node:24.20.0-alpine

EXPOSE 8543

RUN addgroup -S -g 1024 javascript
RUN adduser -D -S -u 1024 -G javascript -h /opt/terminator javascript
RUN mkdir -p /opt/terminator/config
RUN chown -R javascript:javascript /opt/terminator

# Set the config volume
VOLUME ["/opt/terminator/config"]

USER javascript:javascript
WORKDIR /opt/terminator

# Set the application
COPY --chown=javascript:javascript eslint.config.js .
COPY --chown=javascript:javascript package.json .
COPY --chown=javascript:javascript yarn.lock .
RUN yarn install --frozen-lockfile && yarn cache clean
COPY --chown=javascript:javascript src ./src

RUN yarn build

# Start it!
CMD ["node", "src/server.js"]
