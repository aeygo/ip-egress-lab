"use strict";

const { describe, it, afterEach } = require("node:test");
const assert = require("node:assert/strict");
const { loadConfig } = require("../src/config");
const { createApp } = require("../src/app");
const { escapeHtml } = require("../src/views/testPage");
const { EGRESS_TARGET_SECRET, startServer, createLogCapture } = require("../../test-support");

const openServers = [];

afterEach(async () => {
  await Promise.all(openServers.splice(0).map((server) => server.close()));
});

async function startTarget(env = {}) {
  const config = loadConfig({ EGRESS_TARGET_SECRET, TRUST_PROXY_HOPS: "0", ...env });
  const server = await startServer(createApp({ config, logger: createLogCapture("target").logger }));
  openServers.push(server);
  return server.url;
}

describe("legacy Target diagnostics", () => {
  it("keeps the 2.x /inspect fields and adds resolved_source_ip", async () => {
    const baseUrl = await startTarget({ TRUST_PROXY_HOPS: "1" });

    const response = await fetch(`${baseUrl}/inspect?irclickid=abc&test_id=t-1`, {
      headers: { "x-forwarded-for": "198.51.100.77, 192.0.2.44", "x-original-client-ip": "203.0.113.9" }
    });
    const body = await response.json();

    assert.equal(body.network_source_ip, "127.0.0.1");
    assert.equal(body.resolved_source_ip, "192.0.2.44");
    assert.equal(body.customer_ip, "203.0.113.9");
    assert.equal(body.website_tracking_ip, "203.0.113.9");
    assert.deepEqual(body.forwarded_ip_list, ["198.51.100.77", "192.0.2.44"]);
    assert.equal(body.irclickid, "abc");
    assert.equal(body.test_id, "t-1");
    assert.equal(body.utm_source, null);
  });

  it("escapes header and query values on /test-page", async () => {
    const baseUrl = await startTarget();

    const response = await fetch(`${baseUrl}/test-page?test_id=${encodeURIComponent("<script>alert(1)</script>")}`, {
      headers: { "x-original-client-ip": "\"><img src=x onerror=alert(2)>" }
    });
    const html = await response.text();

    assert.equal(response.headers.get("content-type"), "text/html; charset=utf-8");
    assert.ok(!html.includes("<script>alert(1)</script>"));
    assert.ok(!html.includes("<img src=x"));
    assert.ok(html.includes("&lt;script&gt;alert(1)&lt;/script&gt;"));
  });

  it("escapes every HTML-significant character", () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });
});
