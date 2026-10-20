"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");
const { verifySignature } = require("../src/shared/signing");
const {
  GATEWAY_EGRESS_SECRET,
  EGRESS_TARGET_SECRET,
  SAMPLE_IRCLICKID,
  startServer,
  createLogCapture,
  createRecordingStub,
  acknowledge,
  never,
  postSignedJson,
  buildGatewayEvent
} = require("../../test-support");

const openServers = [];

async function track(serverPromise) {
  const server = await serverPromise;
  openServers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

function baseEnv(targetUrl) {
  return {
    GATEWAY_EGRESS_SECRET,
    EGRESS_TARGET_SECRET,
    TARGET_EVENTS_URL: `${targetUrl}/v1/events`,
    TRUST_PROXY_HOPS: "0"
  };
}

async function startEgress({ respond = acknowledge, env = {} } = {}) {
  const target = createRecordingStub(respond);
  const targetServer = await track(startServer(target.listener));
  const config = loadConfig({ ...baseEnv(targetServer.url), ...env });
  const logs = createLogCapture("egress-a");
  const egress = await track(startServer(createApp({ config, logger: logs.logger })));

  return { eventsUrl: `${egress.url}/v1/events`, egressUrl: egress.url, targetRequests: target.requests, logs };
}

function sendEvent(eventsUrl, event, options = {}) {
  return postSignedJson(eventsUrl, { body: event, secret: GATEWAY_EGRESS_SECRET, ...options });
}

describe("POST /v1/events", () => {
  it("forwards a valid event to the configured Target with original params in the URL and the requester IP as labelled metadata", async () => {
    const { eventsUrl, targetRequests, logs } = await startEgress();
    const event = buildGatewayEvent();

    const response = await sendEvent(eventsUrl, event);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.event_id, event.event_id);
    assert.equal(body.data.target_status, 200);

    assert.equal(targetRequests.length, 1);
    const [forwarded] = targetRequests;
    assert.equal(forwarded.url, `/v1/events?irclickid=${SAMPLE_IRCLICKID}&utm_source=google&utm_campaign=lab-test`);
    assert.equal(forwarded.headers["x-forwarded-for"], undefined);
    assert.equal(forwarded.headers["x-original-client-ip"], undefined);
    assert.equal(forwarded.headers["x-lab-event-id"], event.event_id);
    assert.equal(
      verifySignature({ secret: EGRESS_TARGET_SECRET, header: forwarded.headers["x-lab-signature"], rawBody: forwarded.rawBody }).valid,
      true
    );
    assert.equal(
      verifySignature({ secret: GATEWAY_EGRESS_SECRET, header: forwarded.headers["x-lab-signature"], rawBody: forwarded.rawBody }).valid,
      false,
      "each hop must be signed with its own secret"
    );
    assert.deepEqual(forwarded.body, { ...event, egress_forwarded_at: forwarded.body.egress_forwarded_at });

    for (const name of ["event_received", "event_forwarded"]) {
      const [entry] = logs.byEvent(name);
      assert.equal(entry.event_id, event.event_id);
      assert.equal(entry.irclickid, event.irclickid);
      assert.equal(entry.requester_ip_observed_by_gateway, "203.0.113.9");
    }
    assert.equal(logs.byEvent("event_forwarded")[0].status, "delivered");
  });

  for (const [scenario, options, reason] of [
    ["the signature header is missing", { headers: { "x-lab-signature": "" } }, "missing_signature"],
    ["the signature was made with another secret", { secret: EGRESS_TARGET_SECRET }, "signature_mismatch"],
    ["the signature is older than the tolerance window", { timestamp: Math.floor(Date.now() / 1000) - 1000 }, "stale_signature"]
  ]) {
    it(`returns 401 without contacting Target when ${scenario}`, async () => {
      const { eventsUrl, targetRequests, logs } = await startEgress();

      const response = await sendEvent(eventsUrl, buildGatewayEvent(), options);

      assert.equal(response.status, 401);
      assert.equal(targetRequests.length, 0);
      assert.equal(logs.byEvent("request_unauthorized")[0].reason, reason);
    });
  }

  it("returns 415 for a body that is not application/json", async () => {
    const { eventsUrl } = await startEgress();

    const response = await fetch(eventsUrl, { method: "POST", headers: { "content-type": "text/plain" }, body: "hello" });

    assert.equal(response.status, 415);
  });

  it("returns 413 for a body over the payload limit", async () => {
    const { eventsUrl, targetRequests } = await startEgress();

    const response = await sendEvent(eventsUrl, buildGatewayEvent({ padding: "x".repeat(20 * 1024) }));

    assert.equal(response.status, 413);
    assert.equal(targetRequests.length, 0);
  });

  it("rejects a destination URL or any other unexpected field in the payload", async () => {
    const { eventsUrl, targetRequests } = await startEgress();

    const response = await sendEvent(eventsUrl, buildGatewayEvent({ url: "https://attacker.example/collect" }));
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body.data.errors, ["unexpected fields: url"]);
    assert.equal(targetRequests.length, 0);
  });

  it("rejects query parameters that are not on the approved list", async () => {
    const { eventsUrl } = await startEgress();

    const event = buildGatewayEvent();
    event.query_params.redirect = "https://attacker.example";
    const response = await sendEvent(eventsUrl, event);
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body.data.errors, ["query_params.redirect is not an approved parameter"]);
  });

  it("rejects a payload whose query_params.irclickid differs from irclickid", async () => {
    const { eventsUrl } = await startEgress();

    const event = buildGatewayEvent();
    event.query_params.irclickid = "different";
    const response = await sendEvent(eventsUrl, event);

    assert.equal(response.status, 400);
  });

  it("replays the stored acknowledgement for a duplicate event without contacting Target again", async () => {
    const { eventsUrl, targetRequests, logs } = await startEgress();
    const event = buildGatewayEvent();

    const first = await sendEvent(eventsUrl, event);
    const second = await sendEvent(eventsUrl, { ...event, gateway_received_at: new Date().toISOString() });

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(second.headers.get("idempotent-replayed"), "true");
    assert.deepEqual(await second.json(), await first.json());
    assert.equal(targetRequests.length, 1);
    assert.equal(logs.byEvent("event_duplicate")[0].status, "duplicate_replayed");
  });

  it("returns 409 when an event ID is reused with a different payload", async () => {
    const { eventsUrl, targetRequests } = await startEgress();
    const event = buildGatewayEvent();

    await sendEvent(eventsUrl, event);
    const conflicting = await sendEvent(eventsUrl, { ...event, requester_ip_observed_by_gateway: "198.51.100.1" });

    assert.equal(conflicting.status, 409);
    assert.equal(targetRequests.length, 1);
  });

  it("returns 409 for a duplicate that arrives while the first delivery is still in flight", async () => {
    const { eventsUrl, targetRequests } = await startEgress({
      respond: async (record) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        return acknowledge(record);
      }
    });
    const event = buildGatewayEvent();

    const statuses = (await Promise.all([sendEvent(eventsUrl, event), sendEvent(eventsUrl, event)]))
      .map((response) => response.status)
      .sort();

    assert.deepEqual(statuses, [200, 409]);
    assert.equal(targetRequests.length, 1);
  });

  it("allows a retry with the same event ID after Target fails", async () => {
    const { eventsUrl, targetRequests, logs } = await startEgress({
      respond: (record, attempt) =>
        attempt === 1 ? { status: 500, body: { success: false, message: "boom" } } : acknowledge(record)
    });
    const event = buildGatewayEvent();

    const failed = await sendEvent(eventsUrl, event);
    const retried = await sendEvent(eventsUrl, event);

    assert.equal(failed.status, 502);
    assert.equal((await failed.json()).data.target_message, "boom");
    assert.equal(logs.byEvent("event_forward_failed")[0].status, "target_rejected");
    assert.equal(retried.status, 200);
    assert.equal(targetRequests.length, 2);
  });

  it("returns 504 when Target does not respond within TARGET_TIMEOUT_MS", async () => {
    const { eventsUrl, logs } = await startEgress({ respond: never, env: { TARGET_TIMEOUT_MS: "200" } });

    const response = await sendEvent(eventsUrl, buildGatewayEvent());

    assert.equal(response.status, 504);
    assert.equal(logs.byEvent("event_forward_failed")[0].status, "target_timeout");
  });

  it("returns 502 when Target's acknowledgement does not echo the event ID", async () => {
    const { eventsUrl } = await startEgress({
      respond: () => ({ status: 200, body: { success: true, message: "ok", data: { event_id: "other" } } })
    });

    const response = await sendEvent(eventsUrl, buildGatewayEvent());

    assert.equal(response.status, 502);
  });

  it("does not follow redirects from Target", async () => {
    const { eventsUrl, targetRequests } = await startEgress({
      respond: () => ({ status: 302, headers: { location: "https://attacker.example/" }, body: {} })
    });

    const response = await sendEvent(eventsUrl, buildGatewayEvent());

    assert.equal(response.status, 502);
    assert.equal(targetRequests.length, 1);
  });
});

describe("legacy Egress A endpoints", () => {
  it("answers /proxy with 410 and never forwards to the caller-supplied URL", async () => {
    const { egressUrl, targetRequests } = await startEgress();

    const response = await fetch(`${egressUrl}/proxy?url=${encodeURIComponent("https://example.com/")}`);

    assert.equal(response.status, 410);
    assert.equal(targetRequests.length, 0);
  });

  it("keeps /health", async () => {
    const { egressUrl } = await startEgress();

    const response = await fetch(`${egressUrl}/health`);

    assert.deepEqual(await response.json(), { service: "Controlled Egress A", status: "healthy" });
  });

  it("runs /self-test against /inspect on the configured Target origin only", async () => {
    const { egressUrl, targetRequests } = await startEgress({
      respond: () => ({ status: 200, body: { network_source_ip: "127.0.0.1" } })
    });

    const response = await fetch(`${egressUrl}/self-test`);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.mode, "egress-a-self-test");
    assert.equal(targetRequests[0].url, "/inspect?test_id=egress-a-self-test");
  });
});

describe("egress-a configuration", () => {
  it("refuses to use the same secret for both hops", () => {
    assert.throws(
      () => loadConfig({ ...baseEnv("https://target.example.com"), EGRESS_TARGET_SECRET: GATEWAY_EGRESS_SECRET }),
      /must be different secrets/
    );
  });

  it("refuses a Target URL that carries its own query string", () => {
    assert.throws(
      () => loadConfig({ ...baseEnv("https://target.example.com"), TARGET_EVENTS_URL: "https://target.example.com/v1/events?x=1" }),
      /must not contain a query string/
    );
  });
});
