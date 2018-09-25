# Marketing Site

Docker:

```
DROPBOX_ACCESS_TOKEN=xxx docker build . -t now-react-static:initial
docker run -e DROPBOX_ACCESS_TOKEN -p8004:8004 now-react-static:initial
```

Deployment:

Install now Desktop and you get the `now` command line tool.

```
now -e DROPBOX_ACCESS_TOKEN=xxx
```

You can see your apps like this:

```
now ls
> 8 total deployments found under <hidden email> [293ms]
> To list more deployments for an app run `now ls [app]`

  app                 url                                   inst #    type      state    age
  now-react-static    now-react-static-grnfyhsggu.now.sh         -    DOCKER    READY    21h
  app                 app-fdfhkrkfrf.now.sh                      0    NPM       READY    1d
  now-gatsby          now-gatsby-xqyojmxgrt.now.sh               -    DOCKER    ERROR    1d
  niw                 niw-bizozygewq.now.sh                      -    DOCKER    READY    43d

```

You can see each instance for each app like this:

```
now ls now-react-static
> 5 total deployments found under <hidden email> [311ms]
> To list deployment instances run `now ls --all [app]`

  app                 url                                   inst #    type      state    age
  now-react-static    now-react-static-grnfyhsggu.now.sh         -    DOCKER    READY    21h
  now-react-static    now-react-static-knbhjzxoqy.now.sh         -    DOCKER    READY    1d
  now-react-static    now-react-static-tdvckogbkr.now.sh         -    DOCKER    READY    1d
  now-react-static    now-react-static-bvvjprsdow.now.sh         -    DOCKER    READY    1d
  now-react-static    now-react-static-dpbxrixxlp.now.sh         -    DOCKER    READY    1d
```

You can create a now alias for a particular instance like this:

```
$ now alias set now-react-static-grnfyhsggu.now.sh glabs-canvas.now.sh
> Assigning alias glabs-canvas.now.sh to deployment now-react-static-grnfyhsggu.now.sh
> Success! glabs-canvas.now.sh now points to now-react-static-grnfyhsggu.now.sh [3s]
```

You can create an alias from a custom domain like this:

```
now alias set now-react-static-grnfyhsggu.now.sh canvas.glabs.jimmyg.org

The first time you try it will break like this:

```
> Assigning alias canvas.glabs.jimmyg.org to deployment now-react-static-grnfyhsggu.now.sh
> Nameservers: ns-1858.awsdns-40.co.uk, ns-972.awsdns-57.net, ns-166.awsdns-20.com, ns-1273.awsdns-31.org
> Error! We couldn't verify the domain jimmyg.org.

  Please make sure that your nameservers point to zeit.world.
  Examples: (full list at https://zeit.world)
    a.zeit.world        96.45.80.1
    b.zeit.world        46.31.236.1
    c.zeit.world        43.247.170.1

  As an alternative, you can add following records to your DNS settings:
    name        type         value
    _now        TXT          a1a6add8943a890f6f239ad05f6a9a7d25a3e863db6803f9a57f4b05c314a396
                ALIAS        alias.zeit.co
```

If you add the value as a `TXT` record under the `_now` subdomain and then alias your custom domain to `alias.zeit.co` and try again, you'll see this:

```
> Assigning alias canvas.glabs.jimmyg.org to deployment now-react-static-grnfyhsggu.now.sh
> Nameservers: ns-166.awsdns-20.com, ns-972.awsdns-57.net, ns-1273.awsdns-31.org, ns-1858.awsdns-40.co.uk
> Success! Domain jimmyg.org added!
> Certificate for canvas.glabs.jimmyg.org (cert_QwJdkzPn4kPeEbZ) created [10s]
> Success! canvas.glabs.jimmyg.org now points to now-react-static-grnfyhsggu.now.sh [15s]
```

Running locally:

```
cd app
DROPBOX_ACCESS_TOKEN=xxx npm run start
curl -X POST -H 'Content-Type: text/plain' --data 'This is a *very* nice sentence.' http://localhost:8004/api/upload
curl http://localhost:8004/api/download
```
