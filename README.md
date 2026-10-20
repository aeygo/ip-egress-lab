# IP Egress Lab

A controlled test pipeline that ties three things together for one test request:

**requester IP (as observed by Gateway) → existing `irclickid` → event ID**

Gateway forwards the event through Egress A to a Target service we control. Each service logs the event under the same `event_id`, so the three logs can be joined.

> **Scope.** Send only authorized test traffic, and only to a Target you own or control. Egress A forwards to one configured endpoint and carries the requester IP as labelled metadata, never as `X-Forwarded-For`. Do not point it at advertising, affiliate or tracking endpoints, or use it to disguise where traffic comes from.

## Architecture

```
Test browser / Google Ads Script (test-URL generator, not part of this repo)
    │  GET /direct?irclickid=…&utm_source=…[&test_id=…]
    ▼
Gateway  (Render, gateway/)
    │  POST /v1/events   signed with GATEWAY_EGRESS_SECRET
    │  { event_id, irclickid, requester_ip_observed_by_gateway, gateway_received_at, query_params }
    ▼
Egress A (AWS EC2 behind Caddy, egress-a/)
    │  POST <TARGET_EVENTS_URL>?<approved original params>   signed with EGRESS_TARGET_SECRET
    │  { …same fields…, egress_forwarded_at }
    ▼
Target   (Render, target/)
       records the forwarded metadata AND its own view of the connection, then acknowledges the event_id
```

| Service | Entry point | Deployed on |
|---|---|---|
| Gateway | `gateway/server.js` | Render (root directory `gateway`) |
| Egress A | `egress-a/server.js` | AWS EC2, see [egress-a/deploy/ec2/README.md](egress-a/deploy/ec2/README.md). Also runs on Render with `TRUST_PROXY_HOPS=3`. |
| Target | `target/server.js` | Render (root directory `target`), currently `ip-egress-lab-1.onrender.com` |

Each service follows the same layout: `server.js` (startup), `src/app.js` (routes), `src/config.js` (environment), `src/controllers/`, and `src/shared/` (copied shared modules, see below).

## IP fields

The pipeline keeps three different IPs apart and labels each one:

| Field | Recorded by | Meaning |
|---|---|---|
| `requester_ip_observed_by_gateway` | Gateway, then carried as metadata | The test client's address, resolved through Gateway's trusted proxy hops. Egress A and Target never re-derive it. |
| `socket_peer_ip` | Each service, for its own connection | The raw TCP peer. On Render this is always `127.0.0.1` (a local sidecar proxy). |
| `resolved_source_ip` | Each service, for its own connection | The peer resolved through `TRUST_PROXY_HOPS`. On Target this is Egress A's public (Elastic) IP. |

### Trusted proxy hops

Render's proxy chain appends to whatever `X-Forwarded-For` the client sends; it does not replace it. Trusting the left-most entry, or setting `trust proxy: true`, therefore lets any client choose its own "IP". Measured against Target on Render on 17 Oct 2026:

```
X-Forwarded-For: <client-supplied junk>, <real client>, <Cloudflare 104.23.x.x>, <Render 10.x.x.x>
socket peer:     127.0.0.1
```

With `TRUST_PROXY_HOPS=3`, Express skips exactly those three proxies and ignores anything the client prepended. `TRUST_PROXY_HOPS` has no default, so each deployment has to choose a value deliberately. To re-check after a Render infrastructure change, run `curl -H 'X-Forwarded-For: 198.51.100.77' https://<target>/inspect` and confirm that `resolved_source_ip` is your real IP, not `198.51.100.77`.

## Event contract

### 1. Test request → Gateway

```
GET /direct?irclickid=<existing click id>&utm_source=google&utm_campaign=lab[&test_id=<id>]
```

- `irclickid` is required. It must appear exactly once and be 1–256 characters of `A-Z a-z 0-9 . _ ~ -`.
- Only parameters in `APPROVED_QUERY_PARAMS` are forwarded, with values unchanged and in their original order. Values may be up to 512 characters, and repeated parameters are rejected. Any other parameter is dropped and listed in `ignored_query_parameters`, both in the response and in the log.
- `test_id` is optional. If it is present (8–64 characters of `A-Z a-z 0-9 _ -`), it becomes the `event_id`. Otherwise Gateway generates a UUID. Reusing a `test_id` makes the request a retry of the same event (see idempotency below).

Successful response (`200`):

```json
{
  "success": true,
  "message": "Event delivered to Target through Egress A",
  "data": {
    "event_id": "224b8150-31c9-4f9f-8ede-0624cbb33bb5",
    "irclickid": "Qx1Rt9WvjxyNWEQ0Wa2yp1dm",
    "requester_ip_observed_by_gateway": "203.0.113.9",
    "gateway_received_at": "2026-10-17T16:39:45.297Z",
    "query_params": { "irclickid": "Qx1Rt9WvjxyNWEQ0Wa2yp1dm", "utm_source": "google", "utm_campaign": "ip-lab" },
    "ignored_query_parameters": ["gclid"],
    "delivery": {
      "event_id": "224b8150-31c9-4f9f-8ede-0624cbb33bb5",
      "egress_forwarded_at": "2026-10-17T16:39:45.310Z",
      "target_status": 200,
      "target": {
        "event_id": "224b8150-31c9-4f9f-8ede-0624cbb33bb5",
        "forwarded_metadata": { "requester_ip_observed_by_gateway": "203.0.113.9" },
        "observed_by_target": { "socket_peer_ip": "127.0.0.1", "resolved_source_ip": "<Egress A Elastic IP>" },
        "target_received_at": "2026-10-17T16:39:45.319Z"
      }
    }
  }
}
```

| Status | Meaning |
|---|---|
| 400 | Invalid query; `data.errors` lists every problem. Nothing is forwarded. |
| 409 | The same `event_id` is already in flight, or was used with a different payload. |
| 429 | Rate limit exceeded (`RATE_LIMIT_PER_MINUTE` per client IP). |
| 502 | Egress A or Target rejected the event or could not be reached. `data.egress_status` and `data.egress_message` say which. |
| 504 | Egress A or Target timed out. |

### 2. Signed service-to-service requests

Each hop sends `Content-Type: application/json` and:

```
X-Lab-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(secret, "<t>.<raw body>")>
X-Lab-Event-Id:  <event_id>
```

The receiver rejects missing, malformed or wrong signatures, and signatures more than `SIGNATURE_TOLERANCE_SECONDS` (default 300) old, with `401`. Each hop has its own secret, so a Gateway secret cannot be used to call Target directly. Bodies are limited to 16 KB, and unknown fields are rejected, so a payload cannot carry a destination URL. Outbound requests never follow redirects and ignore `HTTP(S)_PROXY`.

### 3. Egress A → Target URL contract

```
<TARGET_EVENTS_URL>?<query_params in original order>
```

`TARGET_EVENTS_URL` is fixed by configuration and may not contain its own query string. Target checks that the URL parameters match the signed `query_params` exactly, and rejects the event with `400` if they don't.

### Idempotency

Egress A remembers each successfully delivered `event_id` for `IDEMPOTENCY_TTL_SECONDS`, in memory:

- a repeat of a delivered event returns the stored acknowledgement with `Idempotent-Replayed: true`, and Target is not called again
- a repeat while the first delivery is in flight gets `409`
- the same `event_id` with a different `irclickid`, requester IP or parameters gets `409`
- a failed delivery is forgotten, so it can be retried with the same `test_id`

The memory is cleared when Egress A restarts, so a retry after a restart can reach Target twice. When analyzing results, deduplicate Target logs on `event_id`.

## Correlating one event across the logs

Every service logs one JSON object per line to stdout:

| Service | `event` | `status` |
|---|---|---|
| Gateway | `event_accepted` | `accepted` |
| Gateway | `event_forwarded` / `event_forward_failed` | `delivered` / `egress_rejected`, `egress_timeout`, `egress_request_failed`, `egress_invalid_response` |
| Egress A | `event_received` | `received` |
| Egress A | `event_forwarded` / `event_forward_failed` | `delivered` / `target_rejected`, `target_timeout`, `target_request_failed`, `target_invalid_response` |
| Egress A | `event_duplicate` | `duplicate_replayed`, `duplicate_in_flight`, `duplicate_conflict` |
| Target | `event_received` | `received` |
| any | `event_rejected`, `request_unauthorized`, `request_rejected` | validation and auth failures |

To trace an event, search for its `event_id` in Render's log explorer (Gateway, Target) and with `journalctl … | jq` on EC2 (Egress A). Every entry for the event carries `irclickid` and `requester_ip_observed_by_gateway`. Target's entry also carries `socket_peer_ip` and `resolved_source_ip`.

## Configuration

Each service has a commented `.env.example`. All variables are validated at startup. If anything is wrong, the service logs one `startup_failed` line listing every problem and exits.

| Variable | Gateway | Egress A | Target | Notes |
|---|:-:|:-:|:-:|---|
| `PORT` | ✓ | ✓ | ✓ | Default `3000`; Render injects it. |
| `HOST` | ✓ | ✓ | ✓ | Default `0.0.0.0`; `127.0.0.1` on EC2 behind Caddy. |
| `TRUST_PROXY_HOPS` | required | required | required | `3` on Render, `1` behind Caddy, `0` when exposed directly. |
| `EGRESS_EVENTS_URL` | required | | | `https://<egress-a>/v1/events`. |
| `GATEWAY_EGRESS_SECRET` | required | required | | At least 32 characters; `openssl rand -hex 32`. |
| `EGRESS_TARGET_SECRET` | | required | required | Must differ from `GATEWAY_EGRESS_SECRET`. |
| `TARGET_EVENTS_URL` | | required | | `https://<target>/v1/events`. |
| `EGRESS_TIMEOUT_MS` | `25000` | | | Keep it above `TARGET_TIMEOUT_MS`. |
| `TARGET_TIMEOUT_MS` | | `20000` | | Render free instances can take 30 s or more to wake. |
| `APPROVED_QUERY_PARAMS` | default list | default list | | Must match on Gateway and Egress A and include `irclickid`. Default: `irclickid,irgwc,lab_click_id,utm_source,utm_medium,utm_campaign,utm_content,utm_term`. |
| `SIGNATURE_TOLERANCE_SECONDS` | | `300` | `300` | |
| `IDEMPOTENCY_TTL_SECONDS` / `IDEMPOTENCY_MAX_ENTRIES` | | `3600` / `10000` | | |
| `RATE_LIMIT_PER_MINUTE` | `60` | `30` | `60` | Applies to public, unauthenticated endpoints only. |

## Running locally

Requires Node.js 22 or 24 (`.nvmrc` pins 24).

```bash
npm run install:all
npm test            # shared-module drift check + every service suite + end-to-end pipeline test
```

To run the three services by hand:

```bash
GE=$(openssl rand -hex 32); ET=$(openssl rand -hex 32)
(cd target   && PORT=4103 EGRESS_TARGET_SECRET=$ET TRUST_PROXY_HOPS=0 npm start) &
(cd egress-a && PORT=4102 GATEWAY_EGRESS_SECRET=$GE EGRESS_TARGET_SECRET=$ET \
   TARGET_EVENTS_URL=http://127.0.0.1:4103/v1/events TRUST_PROXY_HOPS=0 npm start) &
(cd gateway  && PORT=4101 GATEWAY_EGRESS_SECRET=$GE \
   EGRESS_EVENTS_URL=http://127.0.0.1:4102/v1/events TRUST_PROXY_HOPS=0 npm start) &

curl 'http://127.0.0.1:4101/direct?irclickid=Qx1Rt9WvjxyNWEQ0Wa2yp1dm&utm_source=google'
```

Plain `http` endpoint URLs are accepted only for `localhost`, `127.0.0.1` and `[::1]`.

## Deploying

**Gateway and Target on Render.** Root directory `gateway` or `target`. Build command `npm ci`. Start command `npm start`. Health check path `/`. Set the variables from the table above; `engines` selects Node 24.

**Egress A on EC2.** Follow [egress-a/deploy/ec2/README.md](egress-a/deploy/ec2/README.md).

Suggested rollout order: Target, then Egress A, then Gateway. Each new version refuses to start until its new variables are set, and Render keeps the previous deploy serving until the new one starts.

## Shared modules

Render can't read files outside a service's root directory, so each service carries copies of the modules in `shared/` under `src/shared/`. Edit `shared/` only, then run:

```bash
npm run sync:shared    # copy into each service (manifest in scripts/sync-shared.js)
npm run check:shared   # fails if any copy differs; also the first step of npm test
```

## Security and data handling

- **Personal data.** IP addresses, together with click IDs, are personal data under GDPR and India's DPDP Act. Logs on Render and in journald contain both. Keep retention as short as the test needs, restrict log access, and don't export logs outside approved systems.
- **Secrets** come only from the environment, are never logged, and are compared in constant time. Rotate a secret by updating both ends of its hop.
- **Unauthenticated endpoints** (`/`, `/health`, `/egress-ip`, `/self-test`, `/inspect`, `/test-page`) are rate limited and never create events.

## Changes from 2.x (breaking)

| Area | 2.x | 3.0 |
|---|---|---|
| Gateway → Egress A | `GET /proxy?url=<any https URL>&…` with a static `X-Gateway-Token` | Signed `POST /v1/events`. `/proxy` now returns `410 Gone`. |
| Egress destination | Chosen by the caller (`url` parameter) | Fixed by `TARGET_EVENTS_URL` |
| Requester IP | Left-most `X-Forwarded-For` (spoofable), sent downstream as `X-Forwarded-For` | Resolved through `TRUST_PROXY_HOPS`, sent as labelled `requester_ip_observed_by_gateway` metadata |
| Gateway env | `TARGET_URL` (actually Egress A), `EGRESS_TARGET_URL`, `EGRESS_TOKEN` | `EGRESS_EVENTS_URL`, `GATEWAY_EGRESS_SECRET`, `TRUST_PROXY_HOPS` |
| Egress A env | `TARGET_URL`, `GATEWAY_TOKEN` | `TARGET_EVENTS_URL`, `GATEWAY_EGRESS_SECRET`, `EGRESS_TARGET_SECRET`, `TRUST_PROXY_HOPS` |
| Target env | none | `EGRESS_TARGET_SECRET`, `TRUST_PROXY_HOPS` |
| `/direct` response | `{ mode, test_id, customer_ip_detected_by_gateway, … }` | `{ success, message, data }`, as shown above |
| Target `/test-page` | Rendered header and query values unescaped (XSS) | Escaped |
| Target `/inspect` | Unchanged | Adds `resolved_source_ip` |
