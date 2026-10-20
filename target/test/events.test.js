"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");
const { buildOutboundUrl } = require("../src/shared/eventContract");
const {
  GATEWAY_EGRESS_SECRET,
  EGRESS_TARGET_SECRET,
  startServer,
  createLogCapture,
  postSignedJson,
  buildEgressEvent
} = require("../../test-support");

const openServers = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

async function startTarget(env = {}) {
  const config = loadConfig({ EGRESS_TARGET_SECRET, TRUST_PROXY_HOPS: "0", ...env });
  const logs = createLogCapture("target");
  const server = await startServer(createApp({ config, logger: logs.logger }));
  openServers.push(server);
  return { baseUrl: server.url, logs };
}

function sendEvent(baseUrl, event, options = {}) {
  const url = buildOutboundUrl(`${baseUrl}/v1/events`, options.urlParams ?? event.query_params);
  return postSignedJson(url, { body: event, secret: EGRESS_TARGET_SECRET, ...options });
}

describe("POST /v1/events", () => {
  it("acknowledges a valid event and records the forwarded and observed IPs as separate fields", async () => {
    const { baseUrl, logs } = await startTarget();
    const event = buildEgressEvent();

    const response = await sendEvent(baseUrl, event);
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.equal(body.data.event_id, event.event_id);
    assert.equal(body.data.irclickid, event.irclickid);
    assert.deepEqual(body.data.forwarded_metadata, { requester_ip_observed_by_gateway: "203.0.113.9" });
    assert.deepEqual(body.data.observed_by_target, { socket_peer_ip: "127.0.0.1", resolved_source_ip: "127.0.0.1" });

    const [logged] = logs.byEvent("event_received");
    assert.equal(logged.event_id, event.event_id);
    assert.equal(logged.irclickid, event.irclickid);
    assert.equal(logged.status, "received");
    assert.equal(logged.requester_ip_observed_by_gateway, "203.0.113.9");
    assert.equal(logged.socket_peer_ip, "127.0.0.1");
    assert.ok(logged.timestamp);
  });

  it("resolves the network source through trusted proxy hops and ignores spoofed entries", async () => {
    const { baseUrl } = await startTarget({ TRUST_PROXY_HOPS: "1" });

    const response = await sendEvent(baseUrl, buildEgressEvent(), {
      headers: { "x-forwarded-for": "198.51.100.77, 192.0.2.44" }
    });
    const body = await response.json();

    assert.deepEqual(body.data.observed_by_target, { socket_peer_ip: "127.0.0.1", resolved_source_ip: "192.0.2.44" });
    assert.equal(body.data.forwarded_metadata.requester_ip_observed_by_gateway, "203.0.113.9");
  });

  it("returns 401 for a request signed with the Gateway secret instead of the Egress secret", async () => {
    const { baseUrl, logs } = await startTarget();

    const response = await sendEvent(baseUrl, buildEgressEvent(), { secret: GATEWAY_EGRESS_SECRET });

    assert.equal(response.status, 401);
    assert.equal(logs.byEvent("event_received").length, 0);
  });

  it("returns 401 for an unsigned request", async () => {
    const { baseUrl } = await startTarget();

    const response = await fetch(`${baseUrl}/v1/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(buildEgressEvent())
    });

    assert.equal(response.status, 401);
  });

  it("returns 400 for malformed JSON", async () => {
    const { baseUrl } = await startTarget();

    const response = await postSignedJson(`${baseUrl}/v1/events`, { body: "{not json", secret: EGRESS_TARGET_SECRET });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.equal(body.message, "Request body is not valid JSON");
  });

  it("returns 400 when the URL parameters differ from the signed query_params", async () => {
    const { baseUrl, logs } = await startTarget();
    const event = buildEgressEvent();

    const response = await sendEvent(baseUrl, event, { urlParams: { ...event.query_params, irclickid: "tampered" } });
    const body = await response.json();

    assert.equal(response.status, 400);
    assert.deepEqual(body.data.errors, ["URL parameter irclickid does not match query_params"]);
    assert.equal(logs.byEvent("event_rejected")[0].status, "invalid_payload");
  });

  it("returns 400 when egress_forwarded_at is missing", async () => {
    const { baseUrl } = await startTarget();
    const { egress_forwarded_at: _omitted, ...event } = buildEgressEvent();

    const response = await sendEvent(baseUrl, event);

    assert.equal(response.status, 400);
  });
});
