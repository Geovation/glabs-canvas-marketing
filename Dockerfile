FROM node:alpine as base

FROM base as builder
RUN mkdir /app
WORKDIR /app
COPY app/package.json /app
COPY app/package-lock.json /app
RUN npm install

FROM base

COPY --from=builder /app /app

COPY app /app
WORKDIR /app
EXPOSE 8004
ENV NODE_PATH=/app/node_modules
ENV PATH="${PATH}:/app/node_modules/.bin"
ARG DROPBOX_ACCESS_TOKEN
ARG DROPBOX_APP_ID
ARG DROPBOX_REMOTE_FOLDER_PATH
ARG DROPBOX_LOCAL_FOLDER_PATH
ARG STATE_PATH
ARG DROPBOX_SECRET
CMD ["npm", "run", "start"]
