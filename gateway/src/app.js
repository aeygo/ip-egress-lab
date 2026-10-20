"use strict";

const axios = require("axios");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { createDirectController } = require("./controllers/directController");
const { createInfoController } = require("./controllers/infoController");
const { notFoundHandler, createErrorHandler, sendError } = require("./shared/responses");

function createApp({ config, logger, httpClient = axios }) {
  const app = express();

  app.disable("x-powered-by");
  // Only the configured number of proxy hops may supply X-Forwarded-For entries;
  // anything a client prepends is ignored when resolving req.ip.
  app.set("trust proxy", config.trustProxyHops);

  const publicRateLimit = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "Too many requests, try again later")
  });

  const info = createInfoController({ logger, httpClient });
  const direct = createDirectController({ config, logger, httpClient });

  app.get("/", info.describeService);
  app.get("/egress-ip", publicRateLimit, info.reportEgressIp);
  app.get("/direct", publicRateLimit, direct.handleDirect);

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

module.exports = { createApp };
