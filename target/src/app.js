"use strict";

const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { createEventsController } = require("./controllers/eventsController");
const { createInspectController } = require("./controllers/inspectController");
const { signedJsonBodyParser, requireSignature } = require("./shared/signedServer");
const { notFoundHandler, createErrorHandler, sendError } = require("./shared/responses");

const EVENT_BODY_LIMIT = "16kb";

function createApp({ config, logger }) {
  const app = express();

  app.disable("x-powered-by");
  // Replaces the previous `trust proxy: true`, which accepted the left-most (client-supplied)
  // X-Forwarded-For entry as req.ip.
  app.set("trust proxy", config.trustProxyHops);

  const publicRateLimit = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "Too many requests, try again later")
  });

  const inspect = createInspectController({ logger });
  const events = createEventsController({ logger });

  app.get("/", inspect.describeService);
  app.get("/inspect", publicRateLimit, inspect.inspectRequest);
  app.get("/test-page", publicRateLimit, inspect.showTestPage);
  app.post(
    "/v1/events",
    signedJsonBodyParser(EVENT_BODY_LIMIT),
    requireSignature({
      secret: config.egressTargetSecret,
      toleranceSeconds: config.signatureToleranceSeconds,
      logger
    }),
    events.receiveEvent
  );

  app.use(notFoundHandler);
  app.use(createErrorHandler(logger));

  return app;
}

module.exports = { createApp };
