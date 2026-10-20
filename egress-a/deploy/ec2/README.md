# Deploying Egress A on AWS EC2

Egress A runs as a systemd service bound to `127.0.0.1:3000`. Caddy terminates TLS on port 443 and proxies to it. An Elastic IP gives Egress A a stable public address, which Target records as `resolved_source_ip`.

## 1. Instance and network

- **AMI:** Ubuntu Server 24.04 LTS. A `t3.micro` or `t4g.micro` is enough.
- **Elastic IP:** allocate one, associate it with the instance, and point a DNS name at it (for example `egress-a.example.com`). Caddy needs the DNS name to get a certificate.
- **Security group, inbound:**
  - `443/tcp` from Render's outbound IPs for the Gateway service's region (Render dashboard → Gateway service → **Connect** → **Outbound**). Those IPs are shared with other Render customers, so this rule is defence in depth. The HMAC signature is the real authentication.
  - `80/tcp` from anywhere, so Let's Encrypt can complete the HTTP-01 challenge. Caddy redirects everything else to HTTPS.
  - `22/tcp` from your admin IP only, or skip it and use SSM Session Manager.
- **Security group, outbound:** `443/tcp` to anywhere (Target on Render, Let's Encrypt).

## 2. Runtime

Install Node.js 24 LTS. Follow the current instructions at <https://nodejs.org/en/download> or <https://github.com/nodesource/distributions>, then confirm the binary is at `/usr/bin/node`:

```bash
node --version   # v24.x
```

Install Caddy from its official apt repository: <https://caddyserver.com/docs/install#debian-ubuntu-raspbian>.

## 3. Application

```bash
sudo useradd --system --no-create-home --shell /usr/sbin/nologin iplab

sudo git clone https://github.com/aeygo/ip-egress-lab.git /opt/ip-egress-lab
cd /opt/ip-egress-lab/egress-a
sudo npm ci --omit=dev

# Code is owned by root and only readable by the service user.
sudo chown -R root:root /opt/ip-egress-lab
```

## 4. Configuration

```bash
sudo install -d -m 750 -o root -g iplab /etc/ip-egress-lab
sudo install -m 640 -o root -g iplab /opt/ip-egress-lab/egress-a/.env.example /etc/ip-egress-lab/egress-a.env
sudoedit /etc/ip-egress-lab/egress-a.env
```

Set `GATEWAY_EGRESS_SECRET` (the same value as on Gateway), `EGRESS_TARGET_SECRET` (the same value as on Target), and `TARGET_EVENTS_URL`. Keep `HOST=127.0.0.1` and `TRUST_PROXY_HOPS=1`.

## 5. Services

```bash
sudo cp /opt/ip-egress-lab/egress-a/deploy/ec2/ip-egress-lab-egress-a.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now ip-egress-lab-egress-a
sudo systemctl status ip-egress-lab-egress-a

sudo cp /opt/ip-egress-lab/egress-a/deploy/ec2/Caddyfile /etc/caddy/Caddyfile
sudoedit /etc/caddy/Caddyfile          # replace egress-a.example.com with your DNS name
sudo systemctl reload caddy
```

If the configuration is invalid, the service logs a single `startup_failed` line that lists every problem, then exits.

## 6. Verify

```bash
curl https://egress-a.example.com/health
curl https://egress-a.example.com/self-test
```

`/self-test` returns Target's `/inspect` view of this instance. Its `resolved_source_ip` must equal the Elastic IP. If it shows a Cloudflare or `10.x` address instead, Target's `TRUST_PROXY_HOPS` is wrong.

Then set Gateway's `EGRESS_EVENTS_URL` to `https://egress-a.example.com/v1/events`.

## Logs

The service writes one JSON object per line to journald:

```bash
journalctl -u ip-egress-lab-egress-a -o cat -f
journalctl -u ip-egress-lab-egress-a -o cat --since today | jq 'select(.event_id == "<event id>")'
```

journald keeps logs until it reaches its disk limit. These logs contain IP addresses and click IDs, so set `MaxRetentionSec=` in `/etc/systemd/journald.conf` to match your retention policy.

## Updating

```bash
cd /opt/ip-egress-lab
sudo git pull
cd egress-a && sudo npm ci --omit=dev
sudo systemctl restart ip-egress-lab-egress-a
```
