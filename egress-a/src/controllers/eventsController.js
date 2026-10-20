"use strict";

const crypto = require("node:crypto");
const { validateEventEnvelope, buildOutboundUrl } = require("../shared/eventContract");
const { deliverSignedEvent, IDEMPOTENT_REPLAY_HEADER } = require("../shared/signedClient");
const { describePeer } = require("../shared/signedServer");
const { sendError } = require("../shared/responses");
const { version } = require("../../package.json");

const USER_AGENT = `ip-egress-lab-egress-a/${version}`;

const FAILURE_RESPONSES = Object.freeze({
  rejected: { statusCode: 502, message: "Target rejected the event" },
  invalid_response: { statusCode: 502, message: "Target returned an unexpected response" },
  timeout: { statusCode: 504, message: "Target did not respond in time" },
  request_failed: { statusCode: 502, message: "Egress A could not reach Target" }
});

const DUPLICATE_RESPONSES = Object.freeze({
  in_flight: { status: "duplicate_in_flight", message: "Event is already being processed" },
  conflict: { status: "duplicate_conflict", message: "event_id was already used with a different payload" }
});

/* Identity of an event for idempotency purposes; timestamps are excluded so retries match. */
function fingerprintEvent(event) {
  const sortedParams = Object.entries(event.query_params).sort(([a], [b]) => (a < b ? -1 : 1));

  return crypto
    .createHash("sha256")
    .update(JSON.stringify([event.event_id, event.irclickid, event.requester_ip_observed_by_gateway, sortedParams]))
    .digest("hex");
}

function createEventsController({ config, logger, httpClient, idempotencyStore }) {
  async function forwardToTarget(event, logContext) {
    const egressForwardedAt = new Date().toISOString();

    const outbound = {
      schema_version: event.schema_version,
      event_id: event.event_id,
      irclickid: event.irclickid,
      requester_ip_observed_by_gateway: event.requester_ip_observed_by_gateway,
      gateway_received_at: event.gateway_received_at,
      egress_forwarded_at: egressForwardedAt,
      query_params: event.query_params
    };

    const outcome = await deliverSignedEvent({
      url: buildOutboundUrl(config.targetEventsUrl, event.query_params),
      event: outbound,
      secret: config.egressTargetSecret,
      timeoutMs: config.targetTimeoutMs,
      userAgent: USER_AGENT,
      httpClient
    });

    const logFields = {
      ...logContext,
      target_endpoint: config.targetEventsUrl,
      target_status: outcome.httpStatus,
      egress_forwarded_at: egressForwardedAt,
      duration_ms: outcome.durationMs
    };

    if (outcome.status === "delivered") {
      logger.info("event_forwarded", { ...logFields, status: "delivered" });

      return {
        statusCode: 200,
        body: {
          success: true,
          message: "Event forwarded to Target",
          data: {
            ...logContext,
            egress_forwarded_at: egressForwardedAt,
            target_status: outcome.httpStatus,
            target: outcome.acknowledgement
          }
        }
      };
    }

    logger.warn("event_forward_failed", {
      ...logFields,
      status: `target_${outcome.status}`,
      target_message: outcome.downstreamMessage ?? null,
      error_code: outcome.errorCode ?? null,
      error_message: outcome.errorMessage ?? null
    });

    const failure = FAILURE_RESPONSES[outcome.status];

    return {
      statusCode: failure.statusCode,
      body: {
        success: false,
        message: failure.message,
        data: {
          event_id: event.event_id,
          target_status: outcome.httpStatus,
          target_message: outcome.downstreamMessage ?? null
        }
      }
    };
  }

  async function receiveEvent(req, res) {
    const egressReceivedAt = new Date().toISOString();
    const peer = describePeer(req);
    const { errors } = validateEventEnvelope(req.body, {
      stage: "gateway",
      approvedParamNames: config.approvedQueryParams
    });

    if (errors.length > 0) {
      logger.warn("event_rejected", { status: "invalid_payload", errors, egress_received_at: egressReceivedAt, ...peer });
      return sendError(res, 400, "Invalid event payload", { errors });
    }

    const event = req.body;
    const logContext = {
      event_id: event.event_id,
      irclickid: event.irclickid,
      requester_ip_observed_by_gateway: event.requester_ip_observed_by_gateway,
      gateway_received_at: event.gateway_received_at,
      egress_received_at: egressReceivedAt
    };

    const claim = idempotencyStore.claim(event.event_id, fingerprintEvent(event));

    if (claim.outcome === "completed") {
      logger.info("event_duplicate", { ...logContext, status: "duplicate_replayed" });
      res.set(IDEMPOTENT_REPLAY_HEADER, "true");
      return res.status(claim.response.statusCode).json(claim.response.body);
    }

    if (claim.outcome !== "claimed") {
      const duplicate = DUPLICATE_RESPONSES[claim.outcome];
      logger.warn("event_duplicate", { ...logContext, status: duplicate.status });
      return sendError(res, 409, duplicate.message, { event_id: event.event_id });
    }

    logger.info("event_received", {
      ...logContext,
      status: "received",
      query_params: event.query_params,
      gateway_socket_peer_ip: peer.socket_peer_ip,
      gateway_resolved_source_ip: peer.resolved_source_ip
    });

    let result = null;

    try {
      result = await forwardToTarget(event, logContext);
    } finally {
      // Only successful deliveries are remembered; failures may be retried with the same event_id.
      if (result?.body.success) {
        idempotencyStore.complete(event.event_id, result);
      } else {
        idempotencyStore.release(event.event_id);
      }
    }

    return res.status(result.statusCode).json(result.body);
  }

  return { receiveEvent };
}

module.exports = { createEventsController, fingerprintEvent };
