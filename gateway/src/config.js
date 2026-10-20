"use strict";

const { createConfigReader } = require("./shared/configHelpers");

const TRUST_PROXY_HINT = " (3 on Render, 0 when the service is exposed directly)";

function loadConfig(env) {
  const read = createConfigReader(env);

  const config = {
    host: read.ipAddress("HOST", "0.0.0.0"),
    port: read.integer("PORT", { defaultValue: 3000, min: 0, max: 65535 }),
    egressEventsUrl: read.endpointUrl("EGRESS_EVENTS_URL"),
    gatewayEgressSecret: read.secret("GATEWAY_EGRESS_SECRET"),
    egressTimeoutMs: read.integer("EGRESS_TIMEOUT_MS", { defaultValue: 25_000, min: 100, max: 120_000 }),
    trustProxyHops: read.integer("TRUST_PROXY_HOPS", { min: 0, max: 10, hint: TRUST_PROXY_HINT }),
    approvedQueryParams: read.approvedQueryParams("APPROVED_QUERY_PARAMS"),
    rateLimitPerMinute: read.integer("RATE_LIMIT_PER_MINUTE", { defaultValue: 60, min: 1, max: 10_000 })
  };

  read.assertValid();
  return Object.freeze(config);
}

module.exports = { loadConfig };
