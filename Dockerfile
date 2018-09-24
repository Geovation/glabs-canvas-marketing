FROM node:alpine as base

FROM base as builder

RUN mkdir /app
WORKDIR /app

#RUN apk add --virtual build-dependencies build-base
RUN npm install react react-dom express body-parser isomorphic-fetch dropbox commonmark-react-renderer commonmark

FROM base

COPY --from=builder /app /app

COPY app /app
WORKDIR /app
EXPOSE 8004
ENV NODE_PATH=/app/node_modules
ENV PATH="${PATH}:/app/node_modules/.bin"
ARG DROPBOX_ACCESS_TOKEN
CMD ["npm", "run", "start"]
