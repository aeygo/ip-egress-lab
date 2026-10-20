"use strict";

const crypto = require("node:crypto");
const {
  SCHEMA_VERSION,
  EVENT_ID_RULE,
  isValidEventId,
  normalizeIp,
  extractApprovedQueryParams
} = require("../shared/eventContract");
const { deliverSignedEvent } = require("../shared/signedClient");
const { sendError, sendSuccess } = require("../shared/responses");
const { version } = require("../../package.json");

/* Optional caller-supplied event ID, for retries that must reuse the same ID. */
const TEST_ID_PARAM = "test_id";
const USER_AGENT = `ip-egress-lab-gateway/${version}`;

/* Egress statuses that carry meaning for the caller are passed through; others become 502. */
const PASS_THROUGH_EGRESS_STATUSES = new Set([409, 504]);

const FAILURE_RESPONSES = Object.freeze({
  rejected: { statusCode: 502, message: "Egress A rejected the event" },
  invalid_response: { statusCode: 502, message: "Egress A returned an unexpected response" },
  timeout: { statusCode: 504, message: "Egress A did not respond in time" },
  request_failed: { statusCode: 502, message: "Gateway could not reach Egress A" }
});

function readSuppliedTestId(searchParams) {
  const values = searchParams.getAll(TEST_ID_PARAM);

  if (values.length === 0) {
    return { value: null, errors: [] };
  }

  if (values.length > 1) {
    return { value: null, errors: [`${TEST_ID_PARAM} must appear only once`] };
  }

  return isValidEventId(values[0])
    ? { value: values[0], errors: [] }
    : { value: null, errors: [`${TEST_ID_PARAM} ${EVENT_ID_RULE}`] };
}

function failureStatusCode(outcome) {
  if (outcome.status === "rejected" && PASS_THROUGH_EGRESS_STATUSES.has(outcome.httpStatus)) {
    return outcome.httpStatus;
  }

  return FAILURE_RESPONSES[outcome.status].statusCode;
}

function createDirectController({ config, logger, httpClient }) {
  async function handleDirect(req, res) {
    const gatewayReceivedAt = new Date().toISOString();
    const requesterIp = normalizeIp(req.ip);
    const socketPeerIp = normalizeIp(req.socket?.remoteAddress);
    const searchParams = new URL(req.originalUrl, "http://gateway.invalid").searchParams;

    const extracted = extractApprovedQueryParams(searchParams, config.approvedQueryParams, [TEST_ID_PARAM]);
    const suppliedTestId = readSuppliedTestId(searchParams);
    const errors = [...extracted.errors, ...suppliedTestId.errors];

    if (errors.length > 0 || !requesterIp) {
      logger.warn("event_rejected", {
        status: "rejected",
        reason: requesterIp ? "invalid_query" : "requester_ip_unavailable",
        errors,
        irclickid: extracted.params.irclickid ?? null,
        requester_ip_observed_by_gateway: requesterIp,
        socket_peer_ip: socketPeerIp,
        gateway_received_at: gatewayReceivedAt
      });

      return requesterIp
        ? sendError(res, 400, "Invalid test request", { errors })
        : sendError(res, 500, "Gateway could not determine the requester IP");
    }

    const event = {
      schema_version: SCHEMA_VERSION,
      event_id: suppliedTestId.value ?? crypto.randomUUID(),
      irclickid: extracted.params.irclickid,
      requester_ip_observed_by_gateway: requesterIp,
      gateway_received_at: gatewayReceivedAt,
      query_params: extracted.params
    };

    const logContext = {
      event_id: event.event_id,
      irclickid: event.irclickid,
      requester_ip_observed_by_gateway: requesterIp,
      gateway_received_at: gatewayReceivedAt
    };

    logger.info("event_accepted", {
      ...logContext,
      status: "accepted",
      event_id_source: suppliedTestId.value ? "supplied" : "generated",
      socket_peer_ip: socketPeerIp,
      query_params: event.query_params,
      ignored_query_parameters: extracted.ignored
    });

    const outcome = await deliverSignedEvent({
      url: config.egressEventsUrl,
      event,
      secret: config.gatewayEgressSecret,
      timeoutMs: config.egressTimeoutMs,
      userAgent: USER_AGENT,
      httpClient
    });

    if (outcome.status === "delivered") {
      logger.info("event_forwarded", {
        ...logContext,
        status: "delivered",
        egress_status: outcome.httpStatus,
        idempotent_replay: outcome.idempotentReplay,
        duration_ms: outcome.durationMs
      });

      return sendSuccess(res, 200, "Event delivered to Target through Egress A", {
        ...logContext,
        query_params: event.query_params,
        ignored_query_parameters: extracted.ignored,
        delivery: outcome.acknowledgement
      });
    }

    const failure = FAILURE_RESPONSES[outcome.status];

    logger.warn("event_forward_failed", {
      ...logContext,
      status: `egress_${outcome.status}`,
      egress_status: outcome.httpStatus,
      egress_message: outcome.downstreamMessage ?? null,
      error_code: outcome.errorCode ?? null,
      error_message: outcome.errorMessage ?? null,
      duration_ms: outcome.durationMs
    });

    return sendError(res, failureStatusCode(outcome), failure.message, {
      ...logContext,
      egress_status: outcome.httpStatus,
      egress_message: outcome.downstreamMessage ?? null
    });
  }

  return { handleDirect };
}

module.exports = { createDirectController };
