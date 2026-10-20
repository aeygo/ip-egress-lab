"use strict";

/*
 * Canonical source: shared/signedClient.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 *
 * Sending side of a signed service-to-service hop.
 */

const axios = require("axios");
const { SIGNATURE_HEADER, createSignatureHeader } = require("./signing");

const EVENT_ID_HEADER = "x-lab-event-id";
const IDEMPOTENT_REPLAY_HEADER = "idempotent-replayed";
const MAX_RESPONSE_BYTES = 64 * 1024;
const MAX_DOWNSTREAM_MESSAGE_LENGTH = 300;
const TIMEOUT_ERROR_CODES = new Set(["ECONNABORTED", "ETIMEDOUT"]);

function readDownstreamMessage(body) {
  return typeof body?.message === "string"
    ? body.message.slice(0, MAX_DOWNSTREAM_MESSAGE_LENGTH)
    : null;
}

function interpretAcknowledgement(response, eventId, durationMs) {
  const body = response.data;
  const base = { httpStatus: response.status, durationMs };

  if (response.status < 200 || response.status >= 300) {
    return { ...base, status: "rejected", downstreamMessage: readDownstreamMessage(body) };
  }

  if (body?.success !== true || body?.data?.event_id !== eventId) {
    return { ...base, status: "invalid_response", downstreamMessage: readDownstreamMessage(body) };
  }

  return {
    ...base,
    status: "delivered",
    acknowledgement: body.data,
    idempotentReplay: response.headers?.[IDEMPOTENT_REPLAY_HEADER] === "true"
  };
}

/*
 * Outcome.status is one of: delivered, rejected, invalid_response, timeout, request_failed.
 * Redirects are never followed and environment proxies are ignored, so the request only
 * ever reaches the configured endpoint.
 */
async function deliverSignedEvent({ url, event, secret, timeoutMs, userAgent, httpClient = axios }) {
  const rawBody = JSON.stringify(event);
  const startedAt = Date.now();

  try {
    const response = await httpClient.post(url, rawBody, {
      headers: {
        "Content-Type": "application/json",
        "User-Agent": userAgent,
        [SIGNATURE_HEADER]: createSignatureHeader(secret, rawBody),
        [EVENT_ID_HEADER]: event.event_id
      },
      timeout: timeoutMs,
      maxRedirects: 0,
      maxContentLength: MAX_RESPONSE_BYTES,
      maxBodyLength: MAX_RESPONSE_BYTES,
      proxy: false,
      validateStatus: () => true,
      // Send the exact bytes that were signed.
      transformRequest: [(data) => data]
    });

    return interpretAcknowledgement(response, event.event_id, Date.now() - startedAt);
  } catch (error) {
    return {
      status: TIMEOUT_ERROR_CODES.has(error.code) ? "timeout" : "request_failed",
      httpStatus: null,
      durationMs: Date.now() - startedAt,
      errorCode: error.code ?? null,
      errorMessage: error.message
    };
  }
}

module.exports = {
  IDEMPOTENT_REPLAY_HEADER,
  deliverSignedEvent
};
