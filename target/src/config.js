"use strict";

const { createConfigReader } = require("./shared/configHelpers");

const TRUST_PROXY_HINT = " (3 on Render, 0 when the service is exposed directly)";

function loadConfig(env) {
  const read = createConfigReader(env);

  const config = {
    host: read.ipAddress("HOST", "0.0.0.0"),
    port: read.integer("PORT", { defaultValue: 3000, min: 0, max: 65535 }),
    egressTargetSecret: read.secret("EGRESS_TARGET_SECRET"),
    trustProxyHops: read.integer("TRUST_PROXY_HOPS", { min: 0, max: 10, hint: TRUST_PROXY_HINT }),
    signatureToleranceSeconds: read.integer("SIGNATURE_TOLERANCE_SECONDS", { defaultValue: 300, min: 30, max: 3600 }),
    rateLimitPerMinute: read.integer("RATE_LIMIT_PER_MINUTE", { defaultValue: 60, min: 1, max: 10_000 })
  };

  read.assertValid();
  return Object.freeze(config);
}

module.exports = { loadConfig };
