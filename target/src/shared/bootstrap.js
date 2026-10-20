"use strict";

/*
 * Canonical source: shared/bootstrap.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 */

const { createLogger } = require("./logger");

const SHUTDOWN_GRACE_MS = 10_000;

function startService({ service, loadConfig, createApp }) {
  const logger = createLogger({ service });
  let config;

  try {
    config = loadConfig(process.env);
  } catch (error) {
    logger.error("startup_failed", { status: "invalid_config", error_message: error.message });
    process.exitCode = 1;
    return null;
  }

  const app = createApp({ config, logger });

  const server = app.listen(config.port, config.host, (error) => {
    if (error) {
      logger.error("startup_failed", { status: "listen_failed", error_message: error.message });
      process.exitCode = 1;
      return;
    }

    logger.info("service_started", {
      status: "listening",
      host: config.host,
      port: server.address().port,
      trust_proxy_hops: config.trustProxyHops
    });
  });

  function shutdown(signal) {
    logger.info("service_stopping", { status: "stopping", signal });
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), SHUTDOWN_GRACE_MS).unref();
  }

  process.once("SIGTERM", shutdown);
  process.once("SIGINT", shutdown);

  return server;
}

module.exports = { startService };
