# Deploying Freddy on the `webapps` LXC (CTID 111, proxmox)

Freddy is a dynamic (Node) app on the webapps LXC. The LXC's `webapp-add` helper
reserves a port, writes the internal Caddy site block, and enables `webapp@freddy.service`
(see `/etc/webapps/README` on the box). The cluster-edge route + pihole record for
`freddy.bustinjailey.org` already exist (BUS-31).

## First install

Run as root inside the LXC (`ssh root@proxmox.bustinjailey.org 'pct exec 111 -- bash -lc "..."'`):

```bash
# 1. reserve the app + port (pick a free port from /etc/webapps/ports.tsv; 3001 here)
webapp-add freddy 3001

# 2. get the code (build artefacts are NOT committed)
git clone https://github.com/bustinjailey/freddy /opt/apps/freddy/src
cd /opt/apps/freddy/src
npm ci
npm run build            # -> /opt/apps/freddy/src/build

# 3. generate VAPID keys and write the service env file
PUB=$(node -e 'console.log(require("web-push").generateVAPIDKeys().publicKey)')
PRIV=$(node -e 'const k=require("web-push").generateVAPIDKeys();console.log(k.privateKey)')
# (or run `npx web-push generate-vapid-keys` once and paste both halves)
cat > /opt/apps/freddy/env <<EOF
PORT=3001
ORIGIN=https://freddy.bustinjailey.org
VAPID_PUBLIC_KEY=$PUB
VAPID_PRIVATE_KEY=$PRIV
VAPID_SUBJECT=mailto:bustinjailey@gmail.com
FREDDY_IDENTITIES=Justin,Erica
FREDDY_DATA_DIR=/opt/apps/freddy/data
EOF
# NB: keep PUBLIC and PRIVATE from the *same* keypair.

# 4. point run.sh at the built server
cat > /opt/apps/freddy/run.sh <<'EOF'
#!/usr/bin/env bash
# Freddy — SvelteKit (adapter-node). Binds 127.0.0.1:$PORT.
cd /opt/apps/freddy/src
exec node build/index.js
EOF
chmod +x /opt/apps/freddy/run.sh

# 5. ownership + data dir, then start
install -d -o webapp -g webapp /opt/apps/freddy/data
chown -R webapp:webapp /opt/apps/freddy
systemctl restart webapp@freddy
systemctl status --no-pager webapp@freddy
```

Verify: `curl -sI https://freddy.bustinjailey.org/` → `200`, and
`curl -s https://freddy.bustinjailey.org/api/health` → `{"ok":true,...,"pushConfigured":true,...}`.

> adapter-node also needs `HOST=127.0.0.1` only if you want to restrict the bind — the internal
> Caddy reverse-proxies to `127.0.0.1:$PORT` and the LXC has no public interface, so the default
> (`0.0.0.0`) on the LXC's loopback-only-reachable port is fine. Set `HOST=127.0.0.1` in `env` if you
> prefer the tighter bind.

## Updating

```bash
cd /opt/apps/freddy/src
git pull
npm ci
npm run build
chown -R webapp:webapp /opt/apps/freddy
systemctl restart webapp@freddy
```

`/opt/apps/freddy/env` and `/opt/apps/freddy/data/` are untouched by updates — VAPID keys and
the two stored push subscriptions survive.

## Rollback

- Stop/disable: `systemctl disable --now webapp@freddy`
- Remove entirely: also delete `/etc/caddy/Caddyfile.d/freddy.caddy`, the `freddy` line from
  `/etc/webapps/ports.tsv`, `/opt/apps/freddy`, then `systemctl reload caddy`.
- The clean baseline snapshot `pct snapshot 111 post-provision-20260511-1632` predates Freddy, so a
  `pct rollback 111 post-provision-...` (Cluster Operator) reverts the whole LXC if ever needed.
