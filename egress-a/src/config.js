"use strict";

const { createConfigReader } = require("./shared/configHelpers");

const TRUST_PROXY_HINT = " (1 behind Caddy on EC2, 3 on Render, 0 when exposed directly)";

function loadConfig(env) {
  const read = createConfigReader(env);

  const config = {
    host: read.ipAddress("HOST", "0.0.0.0"),
    port: read.integer("PORT", { defaultValue: 3000, min: 0, max: 65535 }),
    gatewayEgressSecret: read.secret("GATEWAY_EGRESS_SECRET"),
    egressTargetSecret: read.secret("EGRESS_TARGET_SECRET"),
    targetEventsUrl: read.endpointUrl("TARGET_EVENTS_URL"),
    targetTimeoutMs: read.integer("TARGET_TIMEOUT_MS", { defaultValue: 20_000, min: 100, max: 120_000 }),
    trustProxyHops: read.integer("TRUST_PROXY_HOPS", { min: 0, max: 10, hint: TRUST_PROXY_HINT }),
    approvedQueryParams: read.approvedQueryParams("APPROVED_QUERY_PARAMS"),
    signatureToleranceSeconds: read.integer("SIGNATURE_TOLERANCE_SECONDS", { defaultValue: 300, min: 30, max: 3600 }),
    idempotencyTtlSeconds: read.integer("IDEMPOTENCY_TTL_SECONDS", { defaultValue: 3600, min: 60, max: 86_400 }),
    idempotencyMaxEntries: read.integer("IDEMPOTENCY_MAX_ENTRIES", { defaultValue: 10_000, min: 100, max: 1_000_000 }),
    rateLimitPerMinute: read.integer("RATE_LIMIT_PER_MINUTE", { defaultValue: 30, min: 1, max: 10_000 })
  };

  if (config.gatewayEgressSecret && config.gatewayEgressSecret === config.egressTargetSecret) {
    read.problem("GATEWAY_EGRESS_SECRET and EGRESS_TARGET_SECRET must be different secrets");
  }

  read.assertValid();
  return Object.freeze(config);
}

module.exports = { loadConfig };
