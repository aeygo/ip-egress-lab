"use strict";

const axios = require("axios");
const express = require("express");
const { rateLimit } = require("express-rate-limit");
const { createEventsController } = require("./controllers/eventsController");
const { createInfoController } = require("./controllers/infoController");
const { IdempotencyStore } = require("./services/idempotencyStore");
const { signedJsonBodyParser, requireSignature } = require("./shared/signedServer");
const { notFoundHandler, createErrorHandler, sendError } = require("./shared/responses");

const EVENT_BODY_LIMIT = "16kb";

function createApp({ config, logger, httpClient = axios, idempotencyStore }) {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxyHops);

  const publicRateLimit = rateLimit({
    windowMs: 60_000,
    limit: config.rateLimitPerMinute,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    handler: (_req, res) => sendError(res, 429, "Too many requests, try again later")
  });

  const info = createInfoController({ config, logger, httpClient });
  const events = createEventsController({
    config,
    logger,
    httpClient,
    idempotencyStore:
      idempotencyStore ??
      new IdempotencyStore({
        ttlMs: config.idempotencyTtlSeconds * 1000,
        maxEntries: config.idempotencyMaxEntries
      })
  });

  app.get("/", info.describeService);
  app.get("/health", info.reportHealth);
  app.get("/self-test", publicRateLimit, info.runSelfTest);
  app.all("/proxy", info.reportProxyRemoved);
  app.post(
    "/v1/events",
    signedJsonBodyParser(EVENT_BODY_LIMIT),
    requireSignature({
      secret: config.gatewayEgressSecret,
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
