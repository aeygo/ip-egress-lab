"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");
const { verifySignature } = require("../src/shared/signing");
const {
  GATEWAY_EGRESS_SECRET,
  SAMPLE_IRCLICKID,
  startServer,
  reserveClosedUrl,
  createLogCapture,
  createRecordingStub,
  acknowledge,
  never
} = require("../../test-support");

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

const openServers = [];

async function track(serverPromise) {
  const server = await serverPromise;
  openServers.push(server);
  return server;
}

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

async function startPipeline({ respond = acknowledge, env = {} } = {}) {
  const egress = createRecordingStub(respond);
  const egressServer = await track(startServer(egress.listener));

  const config = loadConfig({
    EGRESS_EVENTS_URL: `${egressServer.url}/v1/events`,
    GATEWAY_EGRESS_SECRET,
    TRUST_PROXY_HOPS: "0",
    ...env
  });
  const logs = createLogCapture("gateway");
  const gateway = await track(startServer(createApp({ config, logger: logs.logger })));

  return { gatewayUrl: gateway.url, egressRequests: egress.requests, logs };
}

function directUrl(baseUrl, params) {
  return `${baseUrl}/direct?${new URLSearchParams(params)}`;
}

describe("GET /direct", () => {
  it("forwards a signed event with the irclickid, requester IP and only the approved parameters", async () => {
    const { gatewayUrl, egressRequests, logs } = await startPipeline();

    const response = await fetch(
      directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID, utm_source: "google", unapproved: "x" })
    );
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.success, true);
    assert.match(body.data.event_id, UUID_PATTERN);
    assert.deepEqual(body.data.ignored_query_parameters, ["unapproved"]);

    assert.equal(egressRequests.length, 1);
    const [forwarded] = egressRequests;
    assert.equal(forwarded.url, "/v1/events");
    assert.deepEqual(
      verifySignature({ secret: GATEWAY_EGRESS_SECRET, header: forwarded.headers["x-lab-signature"], rawBody: forwarded.rawBody }),
      { valid: true, reason: null }
    );
    assert.equal(forwarded.headers["x-forwarded-for"], undefined);
    assert.deepEqual(forwarded.body, {
      schema_version: 1,
      event_id: body.data.event_id,
      irclickid: SAMPLE_IRCLICKID,
      requester_ip_observed_by_gateway: "127.0.0.1",
      gateway_received_at: forwarded.body.gateway_received_at,
      query_params: { irclickid: SAMPLE_IRCLICKID, utm_source: "google" }
    });

    const [accepted] = logs.byEvent("event_accepted");
    const [delivered] = logs.byEvent("event_forwarded");
    assert.equal(accepted.event_id, body.data.event_id);
    assert.equal(accepted.irclickid, SAMPLE_IRCLICKID);
    assert.equal(accepted.requester_ip_observed_by_gateway, "127.0.0.1");
    assert.equal(accepted.status, "accepted");
    assert.equal(delivered.event_id, body.data.event_id);
    assert.equal(delivered.status, "delivered");
  });

  it("takes the requester IP from the trusted proxy hop and ignores entries the client prepended", async () => {
    const { gatewayUrl, egressRequests } = await startPipeline({ env: { TRUST_PROXY_HOPS: "1" } });

    const response = await fetch(directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID }), {
      headers: { "x-forwarded-for": "198.51.100.77, 203.0.113.9" }
    });

    assert.equal(response.status, 200);
    assert.equal(egressRequests[0].body.requester_ip_observed_by_gateway, "203.0.113.9");
  });

  it("ignores X-Forwarded-For entirely when no proxy hops are trusted", async () => {
    const { gatewayUrl, egressRequests } = await startPipeline();

    await fetch(directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID }), {
      headers: { "x-forwarded-for": "198.51.100.77" }
    });

    assert.equal(egressRequests[0].body.requester_ip_observed_by_gateway, "127.0.0.1");
  });

  it("preserves approved parameter values exactly, in their original order", async () => {
    const { gatewayUrl, egressRequests } = await startPipeline();
    const campaign = "spring sale & más/50%+more";

    await fetch(directUrl(gatewayUrl, { utm_campaign: campaign, irclickid: SAMPLE_IRCLICKID, utm_source: "" }));

    assert.deepEqual(Object.entries(egressRequests[0].body.query_params), [
      ["utm_campaign", campaign],
      ["irclickid", SAMPLE_IRCLICKID],
      ["utm_source", ""]
    ]);
  });

  it("uses a valid supplied test_id as the event ID without forwarding it as a query parameter", async () => {
    const { gatewayUrl, egressRequests, logs } = await startPipeline();

    const response = await fetch(directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID, test_id: "lab-run-0001" }));
    const body = await response.json();

    assert.equal(body.data.event_id, "lab-run-0001");
    assert.equal(egressRequests[0].body.event_id, "lab-run-0001");
    assert.equal(Object.hasOwn(egressRequests[0].body.query_params, "test_id"), false);
    assert.equal(logs.byEvent("event_accepted")[0].event_id_source, "supplied");
  });

  for (const [scenario, query, expectedError] of [
    ["irclickid is missing", "utm_source=google", "irclickid is required"],
    ["irclickid contains characters outside the contract", "irclickid=abc%3Cscript%3E", "irclickid must be"],
    ["irclickid is empty", "irclickid=", "irclickid must be"],
    ["irclickid is repeated", `irclickid=${SAMPLE_IRCLICKID}&irclickid=other`, "irclickid must appear only once"],
    ["test_id is malformed", `irclickid=${SAMPLE_IRCLICKID}&test_id=bad id`, "test_id must be"]
  ]) {
    it(`rejects the request with 400 when ${scenario}`, async () => {
      const { gatewayUrl, egressRequests, logs } = await startPipeline();

      const response = await fetch(`${gatewayUrl}/direct?${query}`);
      const body = await response.json();

      assert.equal(response.status, 400);
      assert.equal(body.success, false);
      assert.ok(body.data.errors.some((error) => error.startsWith(expectedError)), body.data.errors.join("; "));
      assert.equal(egressRequests.length, 0);
      assert.equal(logs.byEvent("event_rejected")[0].status, "rejected");
    });
  }

  it("returns 504 when Egress A does not respond within EGRESS_TIMEOUT_MS", async () => {
    const { gatewayUrl, logs } = await startPipeline({ respond: never, env: { EGRESS_TIMEOUT_MS: "200" } });

    const response = await fetch(directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID }));
    const body = await response.json();

    assert.equal(response.status, 504);
    assert.match(body.data.event_id, UUID_PATTERN);
    assert.equal(logs.byEvent("event_forward_failed")[0].status, "egress_timeout");
  });

  it("returns 502 when Egress A is unreachable", async () => {
    const closedUrl = await reserveClosedUrl();
    const config = loadConfig({
      EGRESS_EVENTS_URL: `${closedUrl}/v1/events`,
      GATEWAY_EGRESS_SECRET,
      TRUST_PROXY_HOPS: "0"
    });
    const logs = createLogCapture("gateway");
    const gateway = await track(startServer(createApp({ config, logger: logs.logger })));

    const response = await fetch(directUrl(gateway.url, { irclickid: SAMPLE_IRCLICKID }));

    assert.equal(response.status, 502);
    assert.equal(logs.byEvent("event_forward_failed")[0].status, "egress_request_failed");
  });

  it("passes a 409 duplicate response from Egress A through to the caller", async () => {
    const { gatewayUrl } = await startPipeline({
      respond: () => ({ status: 409, body: { success: false, message: "Event is already being processed", data: null } })
    });

    const response = await fetch(directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID }));
    const body = await response.json();

    assert.equal(response.status, 409);
    assert.equal(body.data.egress_message, "Event is already being processed");
  });

  it("returns 502 when Egress A acknowledges a different event ID", async () => {
    const { gatewayUrl, logs } = await startPipeline({
      respond: () => ({ status: 200, body: { success: true, message: "ok", data: { event_id: "someone-else" } } })
    });

    const response = await fetch(directUrl(gatewayUrl, { irclickid: SAMPLE_IRCLICKID }));

    assert.equal(response.status, 502);
    assert.equal(logs.byEvent("event_forward_failed")[0].status, "egress_invalid_response");
  });
});

describe("gateway configuration", () => {
  const validEnv = {
    EGRESS_EVENTS_URL: "https://egress-a.example.com/v1/events",
    GATEWAY_EGRESS_SECRET,
    TRUST_PROXY_HOPS: "3"
  };

  it("accepts a complete configuration", () => {
    assert.equal(loadConfig(validEnv).trustProxyHops, 3);
  });

  it("refuses a plain-http Egress URL that is not loopback", () => {
    assert.throws(
      () => loadConfig({ ...validEnv, EGRESS_EVENTS_URL: "http://egress-a.example.com/v1/events" }),
      /EGRESS_EVENTS_URL must use https/
    );
  });

  it("requires TRUST_PROXY_HOPS to be set explicitly", () => {
    assert.throws(() => loadConfig({ ...validEnv, TRUST_PROXY_HOPS: undefined }), /TRUST_PROXY_HOPS is required/);
  });

  it("refuses a short shared secret", () => {
    assert.throws(() => loadConfig({ ...validEnv, GATEWAY_EGRESS_SECRET: "short" }), /GATEWAY_EGRESS_SECRET must be set/);
  });
});
