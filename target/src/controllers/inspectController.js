"use strict";

const { normalizeIp } = require("../shared/eventContract");
const { renderTestPage } = require("../views/testPage");
const { version } = require("../../package.json");

const SERVICE_NAME = "IP Egress Lab Target";
const INSPECTED_QUERY_PARAMS = Object.freeze([
  "irclickid",
  "lab_click_id",
  "irgwc",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "lab_gateway_test_id",
  "test_id"
]);

/*
 * Unauthenticated diagnostic endpoints kept from 2.x. Their response shapes are unchanged;
 * /inspect gains resolved_source_ip, the peer address resolved through TRUST_PROXY_HOPS.
 */
function createInspectController({ logger }) {
  function describeService(_req, res) {
    res.json({
      service: SERVICE_NAME,
      status: "ok",
      version,
      endpoints: ["/", "/inspect", "/test-page", "/v1/events"]
    });
  }

  function inspectRequest(req, res) {
    const forwardedFor = req.get("x-forwarded-for") || "";
    const forwardedIps = forwardedFor.split(",").map((ip) => ip.trim()).filter(Boolean);
    const customerIp = req.get("x-original-client-ip") || null;

    const result = {
      timestamp: new Date().toISOString(),
      network_source_ip: req.socket?.remoteAddress || null,
      resolved_source_ip: normalizeIp(req.ip),
      customer_ip: customerIp,
      website_tracking_ip: customerIp,
      forwarded_for: forwardedFor || null,
      forwarded_ip_list: forwardedIps,
      observed_gateway_ip: forwardedIps.length > 1 ? forwardedIps[1] : null,
      real_ip: req.get("x-real-ip") || null,
      query_parameters: req.query,
      ...Object.fromEntries(INSPECTED_QUERY_PARAMS.map((name) => [name, req.query[name] || null])),
      user_agent: req.get("user-agent") || null,
      host: req.get("host") || null
    };

    logger.info("inspect_request", result);
    res.json(result);
  }

  function showTestPage(req, res) {
    res.type("html").send(
      renderTestPage({
        customerIp: req.get("x-original-client-ip") || "Unknown",
        networkSourceIp: normalizeIp(req.ip) || "Unknown",
        testId: req.query.lab_gateway_test_id || req.query.test_id || "No test ID"
      })
    );
  }

  return { describeService, inspectRequest, showTestPage };
}

module.exports = { createInspectController };
