# Marketing Site

Docker:

```
DROPBOX_ACCESS_TOKEN=xxx docker build . -t now-react-static:initial
docker run -e DROPBOX_ACCESS_TOKEN -p8004:8004 now-react-static:initial
```

Deployment:

```
now -e DROPBOX_ACCESS_TOKEN=xxx
```

Running locally:

```
cd app
DROPBOX_ACCESS_TOKEN=xxx npm run start
curl -X POST -H 'Content-Type: text/plain' --data 'This is a *very* nice sentence.' http://localhost:8004/api/upload
curl http://localhost:8004/api/download
```
