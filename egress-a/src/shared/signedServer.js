"use strict";

/*
 * Canonical source: shared/signedServer.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 *
 * Receiving side of a signed service-to-service hop: accept only correctly signed JSON.
 */

const express = require("express");
const { SIGNATURE_HEADER, verifySignature } = require("./signing");
const { normalizeIp } = require("./eventContract");
const { sendError } = require("./responses");

function captureRawBody(req, _res, buffer) {
  req.rawBody = buffer.toString("utf8");
}

function signedJsonBodyParser(limit) {
  return express.json({ limit, type: "application/json", verify: captureRawBody });
}

/* The connection as this service observed it, independent of any payload. */
function describePeer(req) {
  return {
    socket_peer_ip: normalizeIp(req.socket?.remoteAddress),
    resolved_source_ip: normalizeIp(req.ip)
  };
}

function requireSignature({ secret, toleranceSeconds, logger }) {
  return function verifySignedRequest(req, res, next) {
    if (typeof req.rawBody !== "string") {
      logger.warn("request_rejected", {
        status: "unsupported_media_type",
        path: req.path,
        ...describePeer(req)
      });
      return sendError(res, 415, "Content-Type must be application/json");
    }

    const result = verifySignature({
      secret,
      header: req.get(SIGNATURE_HEADER),
      rawBody: req.rawBody,
      toleranceSeconds
    });

    if (!result.valid) {
      logger.warn("request_unauthorized", {
        status: "unauthorized",
        reason: result.reason,
        path: req.path,
        ...describePeer(req)
      });
      return sendError(res, 401, "Request signature is missing or invalid");
    }

    return next();
  };
}

module.exports = {
  signedJsonBodyParser,
  requireSignature,
  describePeer
};
