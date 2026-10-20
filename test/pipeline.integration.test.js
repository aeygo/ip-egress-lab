"use strict";

/*
 * Runs Gateway, Egress A and Target in-process over real HTTP on loopback and checks
 * that one test request produces matching log entries in all three services.
 */

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const gateway = require("../gateway/src/app");
const gatewayConfig = require("../gateway/src/config");
const egress = require("../egress-a/src/app");
const egressConfig = require("../egress-a/src/config");
const target = require("../target/src/app");
const targetConfig = require("../target/src/config");
const {
  GATEWAY_EGRESS_SECRET,
  EGRESS_TARGET_SECRET,
  SAMPLE_IRCLICKID,
  startServer,
  createLogCapture
} = require("../test-support");

const SPOOFED_IP = "198.51.100.77";
const REQUESTER_IP = "203.0.113.9";

describe("Gateway -> Egress A -> Target pipeline", () => {
  const logs = {
    gateway: createLogCapture("gateway"),
    egress: createLogCapture("egress-a"),
    target: createLogCapture("target")
  };
  const servers = [];
  let gatewayUrl;

  before(async () => {
    const targetServer = await startServer(
      target.createApp({
        config: targetConfig.loadConfig({ EGRESS_TARGET_SECRET, TRUST_PROXY_HOPS: "0" }),
        logger: logs.target.logger
      })
    );

    const egressServer = await startServer(
      egress.createApp({
        config: egressConfig.loadConfig({
          GATEWAY_EGRESS_SECRET,
          EGRESS_TARGET_SECRET,
          TARGET_EVENTS_URL: `${targetServer.url}/v1/events`,
          TRUST_PROXY_HOPS: "0"
        }),
        logger: logs.egress.logger
      })
    );

    // One trusted hop stands in for the hosting platform's proxy in front of Gateway.
    const gatewayServer = await startServer(
      gateway.createApp({
        config: gatewayConfig.loadConfig({
          EGRESS_EVENTS_URL: `${egressServer.url}/v1/events`,
          GATEWAY_EGRESS_SECRET,
          TRUST_PROXY_HOPS: "1"
        }),
        logger: logs.gateway.logger
      })
    );

    servers.push(gatewayServer, egressServer, targetServer);
    gatewayUrl = gatewayServer.url;
  });

  after(async () => {
    await Promise.all(servers.map((server) => server.close()));
  });

  function sendTestRequest(params) {
    return fetch(`${gatewayUrl}/direct?${new URLSearchParams(params)}`, {
      headers: { "x-forwarded-for": `${SPOOFED_IP}, ${REQUESTER_IP}` }
    });
  }

  it("correlates requester IP -> irclickid -> event ID in the logs of all three services", async () => {
    const response = await sendTestRequest({
      irclickid: SAMPLE_IRCLICKID,
      utm_source: "google",
      utm_campaign: "ip-lab",
      unapproved: "dropped"
    });
    const body = await response.json();

    assert.equal(response.status, 200, JSON.stringify(body));
    const eventId = body.data.event_id;

    const correlated = {
      gateway: logs.gateway.entries.filter((entry) => entry.event_id === eventId),
      egress: logs.egress.entries.filter((entry) => entry.event_id === eventId),
      target: logs.target.entries.filter((entry) => entry.event_id === eventId)
    };

    assert.deepEqual(correlated.gateway.map((entry) => entry.status), ["accepted", "delivered"]);
    assert.deepEqual(correlated.egress.map((entry) => entry.status), ["received", "delivered"]);
    assert.deepEqual(correlated.target.map((entry) => entry.status), ["received"]);

    for (const entry of Object.values(correlated).flat()) {
      assert.equal(entry.irclickid, SAMPLE_IRCLICKID, `${entry.service}/${entry.event}`);
      assert.equal(entry.requester_ip_observed_by_gateway, REQUESTER_IP, `${entry.service}/${entry.event}`);
      assert.ok(entry.timestamp);
    }

    const [targetEntry] = correlated.target;
    assert.equal(targetEntry.socket_peer_ip, "127.0.0.1", "Target records its own network peer");
    assert.notEqual(targetEntry.socket_peer_ip, targetEntry.requester_ip_observed_by_gateway);
    assert.deepEqual(targetEntry.query_params, {
      irclickid: SAMPLE_IRCLICKID,
      utm_source: "google",
      utm_campaign: "ip-lab"
    });

    const allLogs = JSON.stringify([...logs.gateway.entries, ...logs.egress.entries, ...logs.target.entries]);
    assert.ok(!allLogs.includes(SPOOFED_IP), "client-supplied X-Forwarded-For entries must never be recorded as the requester IP");
    assert.ok(!allLogs.includes(GATEWAY_EGRESS_SECRET) && !allLogs.includes(EGRESS_TARGET_SECRET), "secrets must never be logged");

    const acknowledgement = body.data.delivery.target;
    assert.equal(acknowledgement.event_id, eventId);
    assert.equal(acknowledgement.forwarded_metadata.requester_ip_observed_by_gateway, REQUESTER_IP);
    assert.equal(acknowledgement.observed_by_target.socket_peer_ip, "127.0.0.1");
  });

  it("delivers a retried test_id to Target only once", async () => {
    const params = { irclickid: SAMPLE_IRCLICKID, test_id: "lab-retry-0001" };

    const first = await sendTestRequest(params);
    const second = await sendTestRequest(params);

    assert.equal(first.status, 200);
    assert.equal(second.status, 200);
    assert.equal(
      logs.target.byEvent("event_received").filter((entry) => entry.event_id === "lab-retry-0001").length,
      1
    );
    assert.equal(
      logs.gateway.byEvent("event_forwarded").find((entry) => entry.event_id === "lab-retry-0001" && entry.idempotent_replay)
        ?.status,
      "delivered"
    );
  });
});
