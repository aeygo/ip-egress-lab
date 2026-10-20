"use strict";

const { sendError } = require("../shared/responses");
const { version } = require("../../package.json");

const SERVICE_NAME = "Controlled Egress A";
const SELF_TEST_TIMEOUT_MS = 15_000;

/* Response shapes here predate the { success, message, data } envelope and are kept for existing callers. */
function createInfoController({ config, logger, httpClient }) {
  // Same origin as the configured Target endpoint, so self-test cannot be pointed elsewhere.
  const targetInspectUrl = new URL("/inspect", config.targetEventsUrl).toString();

  function describeService(_req, res) {
    res.json({
      service: SERVICE_NAME,
      status: "ok",
      version,
      endpoints: ["/", "/health", "/self-test", "/v1/events"]
    });
  }

  function reportHealth(_req, res) {
    res.json({ service: SERVICE_NAME, status: "healthy" });
  }

  /* Shows which source IP Target observes for Egress A, without creating an event. */
  async function runSelfTest(_req, res) {
    try {
      const response = await httpClient.get(targetInspectUrl, {
        params: { test_id: "egress-a-self-test" },
        timeout: SELF_TEST_TIMEOUT_MS,
        maxRedirects: 0,
        proxy: false,
        validateStatus: () => true
      });

      res.status(response.status).json({ mode: "egress-a-self-test", target: response.data });
    } catch (error) {
      logger.error("self_test_failed", { status: "error", error_message: error.message });
      res.status(502).json({ error: "Egress A could not reach Target", message: error.message });
    }
  }

  function reportProxyRemoved(_req, res) {
    return sendError(
      res,
      410,
      "/proxy was removed in 3.0.0 because it forwarded to caller-supplied URLs. Gateway now sends signed events to POST /v1/events."
    );
  }

  return { describeService, reportHealth, runSelfTest, reportProxyRemoved };
}

module.exports = { createInfoController };
