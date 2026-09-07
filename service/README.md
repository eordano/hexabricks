# Hexabricks Genesis persistence peer

Small WebSocket persistence service for the Genesis City scene. It journals
each accepted lay, paint, and delete before updating its atomic disk snapshot.
Clients receive one compressed snapshot on connect and deltas afterward; local
changes queue and merge after reconnecting.

## Run

```bash
cd service
npm install
HEXABRICKS_DATA_FILE=/var/lib/hexabricks/state.json npm start
```

The process binds to `127.0.0.1:8787` by default. Configure the reverse proxy
for your domain to pass WebSocket upgrades on `/hexabricks/ws`;
`/hexabricks/health` is the health-check endpoint. Override the bind address
and port with `HEXABRICKS_HOST` and `HEXABRICKS_PORT`. Clients default to the
public service at `wss://interconnected.online/hexabricks/ws`; point them at
another host with the `?server=` query parameter in the browser.

Example nginx location (the trailing slash on `proxy_pass` is intentionally
absent so the service receives the `/hexabricks/...` path):

```nginx
location /hexabricks/ {
    proxy_pass http://127.0.0.1:8787;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 75s;
}
```

The current protocol intentionally follows the scene's temporary open-build
policy. Before permissions are restored, add a signed Decentraland identity
challenge at the proxy/service boundary and enforce ownership in `server.ts`.
