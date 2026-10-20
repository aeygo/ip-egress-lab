"use strict";

/* Test helpers shared by every service's test suite. Not deployed. */

const crypto = require("node:crypto");
const http = require("node:http");
const { once } = require("node:events");
const { createLogger } = require("../shared/logger");
const { createSignatureHeader } = require("../shared/signing");

const GATEWAY_EGRESS_SECRET = "test-gateway-to-egress-secret-0123456789abcdef";
const EGRESS_TARGET_SECRET = "test-egress-to-target-secret-0123456789abcdef";
const SAMPLE_IRCLICKID = "Qx1Rt9WvjxyNWEQ0Wa2yp1dmUkGxMHVOdW1TwQ0";

/* Starts an Express app or plain request listener on an ephemeral loopback port. */
async function startServer(listener) {
  const server = http.createServer(listener);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  return {
    url: `http://127.0.0.1:${server.address().port}`,
    async close() {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  };
}

/* A URL on loopback that refuses connections. */
async function reserveClosedUrl() {
  const server = await startServer((_req, res) => res.end());
  await server.close();
  return server.url;
}

function createLogCapture(service) {
  const entries = [];
  const logger = createLogger({ service, write: (line) => entries.push(JSON.parse(line)) });

  return {
    logger,
    entries,
    byEvent: (event) => entries.filter((entry) => entry.event === event)
  };
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

/*
 * A downstream stand-in that records each request and answers with `respond(record)`,
 * which returns { status, body, headers } or never settles to simulate a hung service.
 */
function createRecordingStub(respond) {
  const requests = [];

  async function listener(req, res) {
    const rawBody = await readBody(req);
    const record = {
      method: req.method,
      url: req.url,
      headers: req.headers,
      rawBody,
      body: rawBody ? JSON.parse(rawBody) : null
    };
    requests.push(record);

    const { status = 200, body = {}, headers = {} } = await respond(record, requests.length);
    res.writeHead(status, { "content-type": "application/json", ...headers });
    res.end(JSON.stringify(body));
  }

  return { listener, requests };
}

function acknowledge(record, extraData = {}) {
  return {
    status: 200,
    body: { success: true, message: "ok", data: { event_id: record.body.event_id, ...extraData } }
  };
}

function never() {
  return new Promise(() => {});
}

function postSignedJson(url, { body, secret, timestamp, headers = {} }) {
  const rawBody = typeof body === "string" ? body : JSON.stringify(body);

  return fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-lab-signature": createSignatureHeader(secret, rawBody, timestamp),
      ...headers
    },
    body: rawBody
  });
}

function buildGatewayEvent(overrides = {}) {
  const irclickid = overrides.irclickid ?? SAMPLE_IRCLICKID;

  return {
    schema_version: 1,
    event_id: crypto.randomUUID(),
    irclickid,
    requester_ip_observed_by_gateway: "203.0.113.9",
    gateway_received_at: new Date().toISOString(),
    query_params: { irclickid, utm_source: "google", utm_campaign: "lab-test" },
    ...overrides
  };
}

function buildEgressEvent(overrides = {}) {
  return buildGatewayEvent({ egress_forwarded_at: new Date().toISOString(), ...overrides });
}

module.exports = {
  GATEWAY_EGRESS_SECRET,
  EGRESS_TARGET_SECRET,
  SAMPLE_IRCLICKID,
  startServer,
  reserveClosedUrl,
  createLogCapture,
  createRecordingStub,
  acknowledge,
  never,
  postSignedJson,
  buildGatewayEvent,
  buildEgressEvent
};
