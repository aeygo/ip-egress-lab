"use strict";

const { validateEventEnvelope, findQueryMismatches } = require("../shared/eventContract");
const { describePeer } = require("../shared/signedServer");
const { sendError, sendSuccess } = require("../shared/responses");

function createEventsController({ logger }) {
  function receiveEvent(req, res) {
    const targetReceivedAt = new Date().toISOString();
    // Observed by Target itself; never taken from the event payload.
    const observedByTarget = describePeer(req);

    const { errors } = validateEventEnvelope(req.body, { stage: "egress" });

    if (errors.length === 0) {
      const searchParams = new URL(req.originalUrl, "http://target.invalid").searchParams;
      errors.push(...findQueryMismatches(searchParams, req.body.query_params));
    }

    if (errors.length > 0) {
      logger.warn("event_rejected", {
        status: "invalid_payload",
        errors,
        target_received_at: targetReceivedAt,
        ...observedByTarget
      });
      return sendError(res, 400, "Invalid event payload", { errors });
    }

    const event = req.body;

    logger.info("event_received", {
      status: "received",
      event_id: event.event_id,
      irclickid: event.irclickid,
      requester_ip_observed_by_gateway: event.requester_ip_observed_by_gateway,
      socket_peer_ip: observedByTarget.socket_peer_ip,
      resolved_source_ip: observedByTarget.resolved_source_ip,
      query_params: event.query_params,
      gateway_received_at: event.gateway_received_at,
      egress_forwarded_at: event.egress_forwarded_at,
      target_received_at: targetReceivedAt
    });

    return sendSuccess(res, 200, "Event received by Target", {
      event_id: event.event_id,
      irclickid: event.irclickid,
      forwarded_metadata: {
        requester_ip_observed_by_gateway: event.requester_ip_observed_by_gateway
      },
      observed_by_target: observedByTarget,
      query_params: event.query_params,
      gateway_received_at: event.gateway_received_at,
      egress_forwarded_at: event.egress_forwarded_at,
      target_received_at: targetReceivedAt
    });
  }

  return { receiveEvent };
}

module.exports = { createEventsController };
