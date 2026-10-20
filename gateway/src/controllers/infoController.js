"use strict";

const { version } = require("../../package.json");

const SERVICE_NAME = "Controlled IP Egress Gateway";
const EGRESS_IP_LOOKUP_URL = "https://api.ipify.org?format=json";
const EGRESS_IP_LOOKUP_TIMEOUT_MS = 10_000;

/* Response shapes here predate the { success, message, data } envelope and are kept for existing callers. */
function createInfoController({ logger, httpClient }) {
  function describeService(_req, res) {
    res.json({
      service: SERVICE_NAME,
      status: "ok",
      version,
      endpoints: ["/", "/direct", "/egress-ip"]
    });
  }

  async function reportEgressIp(_req, res) {
    try {
      const response = await httpClient.get(EGRESS_IP_LOOKUP_URL, {
        timeout: EGRESS_IP_LOOKUP_TIMEOUT_MS,
        maxRedirects: 0,
        proxy: false
      });

      res.json({ service: SERVICE_NAME, egress_ip: response.data.ip });
    } catch (error) {
      logger.error("egress_ip_lookup_failed", { status: "error", error_message: error.message });
      res.status(502).json({ error: "Could not determine egress IP", message: error.message });
    }
  }

  return { describeService, reportEgressIp };
}

module.exports = { createInfoController };
