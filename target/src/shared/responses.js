"use strict";

/*
 * Canonical source: shared/responses.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 */

const BODY_PARSER_ERRORS = Object.freeze({
  "entity.too.large": { statusCode: 413, message: "Request body is too large" },
  "entity.parse.failed": { statusCode: 400, message: "Request body is not valid JSON" },
  "entity.verify.failed": { statusCode: 400, message: "Request body could not be read" },
  "request.aborted": { statusCode: 400, message: "Request was aborted" },
  "request.size.invalid": { statusCode: 400, message: "Request body size did not match Content-Length" },
  "encoding.unsupported": { statusCode: 415, message: "Unsupported request body encoding" },
  "charset.unsupported": { statusCode: 415, message: "Unsupported request body charset" }
});

function sendSuccess(res, statusCode, message, data) {
  return res.status(statusCode).json({ success: true, message, data });
}

function sendError(res, statusCode, message, data = null) {
  return res.status(statusCode).json({ success: false, message, data });
}

function notFoundHandler(_req, res) {
  return sendError(res, 404, "Route not found");
}

function createErrorHandler(logger) {
  // Express identifies error handlers by their four-argument signature.
  return function handleError(error, req, res, next) {
    if (res.headersSent) {
      return next(error);
    }

    const bodyError = Object.hasOwn(BODY_PARSER_ERRORS, error.type)
      ? BODY_PARSER_ERRORS[error.type]
      : null;

    if (bodyError) {
      logger.warn("request_rejected", {
        status: "invalid_body",
        reason: error.type,
        method: req.method,
        path: req.path
      });
      return sendError(res, bodyError.statusCode, bodyError.message);
    }

    logger.error("unhandled_error", {
      status: "error",
      method: req.method,
      path: req.path,
      error_message: error.message,
      stack: error.stack
    });
    return sendError(res, 500, "Internal server error");
  };
}

module.exports = {
  sendSuccess,
  sendError,
  notFoundHandler,
  createErrorHandler
};
