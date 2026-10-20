"use strict";

/*
 * Canonical source: shared/eventContract.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 *
 * The event contract shared by Gateway, Egress A and Target:
 *   - which query parameters are approved for forwarding, and how they are validated
 *   - the JSON envelope each hop sends
 *   - how Egress A builds the outbound Target URL
 */

const net = require("node:net");

const SCHEMA_VERSION = 1;

const EVENT_ID_PATTERN = /^[A-Za-z0-9_-]{8,64}$/;
const IRCLICKID_PATTERN = /^[A-Za-z0-9._~-]{1,256}$/;
const PARAM_NAME_PATTERN = /^[A-Za-z0-9_.-]{1,64}$/;
const RESERVED_PARAM_NAMES = new Set(["__proto__", "constructor", "prototype"]);
const ISO_UTC_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

const MAX_PARAM_VALUE_LENGTH = 512;
const MAX_QUERY_PARAMS = 32;
const MAX_REPORTED_NAMES = 20;
const MAX_REPORTED_NAME_LENGTH = 64;

const IRCLICKID_RULE =
  "irclickid must be 1-256 characters of A-Z, a-z, 0-9, '.', '_', '~' or '-'";
const EVENT_ID_RULE =
  "must be 8-64 characters of A-Z, a-z, 0-9, '_' or '-'";

const DEFAULT_APPROVED_QUERY_PARAMS = Object.freeze([
  "irclickid",
  "irgwc",
  "lab_click_id",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term"
]);

const GATEWAY_ENVELOPE_FIELDS = Object.freeze([
  "schema_version",
  "event_id",
  "irclickid",
  "requester_ip_observed_by_gateway",
  "gateway_received_at",
  "query_params"
]);

const ENVELOPE_FIELDS_BY_STAGE = Object.freeze({
  gateway: GATEWAY_ENVELOPE_FIELDS,
  egress: Object.freeze([...GATEWAY_ENVELOPE_FIELDS, "egress_forwarded_at"])
});

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSafeParamName(name) {
  return PARAM_NAME_PATTERN.test(name) && !RESERVED_PARAM_NAMES.has(name);
}

function isIsoUtcTimestamp(value) {
  return (
    typeof value === "string" &&
    ISO_UTC_TIMESTAMP_PATTERN.test(value) &&
    !Number.isNaN(Date.parse(value))
  );
}

function isValidEventId(value) {
  return typeof value === "string" && EVENT_ID_PATTERN.test(value);
}

function isValidIrclickid(value) {
  return typeof value === "string" && IRCLICKID_PATTERN.test(value);
}

/* Names echoed back to callers or logs are untrusted input; keep them bounded. */
function summarizeNames(names) {
  return names
    .slice(0, MAX_REPORTED_NAMES)
    .map((name) => name.slice(0, MAX_REPORTED_NAME_LENGTH));
}

/* Returns a plain address with IPv4-mapped IPv6 unwrapped, or null when not an IP. */
function normalizeIp(value) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  const mappedPrefix = "::ffff:";
  const unmapped =
    trimmed.toLowerCase().startsWith(mappedPrefix) && net.isIPv4(trimmed.slice(mappedPrefix.length))
      ? trimmed.slice(mappedPrefix.length)
      : trimmed;

  return net.isIP(unmapped) ? unmapped : null;
}

function parseApprovedParamList(csv) {
  const names =
    typeof csv === "string" && csv.trim() !== ""
      ? csv.split(",").map((name) => name.trim()).filter(Boolean)
      : [...DEFAULT_APPROVED_QUERY_PARAMS];

  const invalid = names.filter((name) => !isSafeParamName(name));

  if (invalid.length > 0) {
    throw new Error(`APPROVED_QUERY_PARAMS contains invalid names: ${summarizeNames(invalid).join(", ")}`);
  }

  if (!names.includes("irclickid")) {
    throw new Error("APPROVED_QUERY_PARAMS must include irclickid");
  }

  return Object.freeze([...new Set(names)]);
}

/*
 * Splits an incoming query string into approved parameters (forwarded unchanged),
 * ignored parameter names (reported, never forwarded) and validation errors.
 * Control parameters are consumed by the caller and are neither forwarded nor reported.
 */
function extractApprovedQueryParams(searchParams, approvedNames, controlNames = []) {
  const approved = new Set(approvedNames);
  const control = new Set(controlNames);
  const entries = [];
  const ignored = [];
  const errors = [];

  for (const name of new Set(searchParams.keys())) {
    if (control.has(name)) {
      continue;
    }

    if (!approved.has(name)) {
      ignored.push(name);
      continue;
    }

    const values = searchParams.getAll(name);

    if (values.length > 1) {
      errors.push(`${name} must appear only once`);
    } else if (values[0].length > MAX_PARAM_VALUE_LENGTH) {
      errors.push(`${name} must be at most ${MAX_PARAM_VALUE_LENGTH} characters`);
    } else {
      entries.push([name, values[0]]);
    }
  }

  const params = Object.fromEntries(entries);

  if (!searchParams.has("irclickid")) {
    errors.push("irclickid is required");
  } else if (Object.hasOwn(params, "irclickid") && !isValidIrclickid(params.irclickid)) {
    errors.push(IRCLICKID_RULE);
  }

  return { params, ignored: summarizeNames(ignored), errors };
}

function validateQueryParamsObject(queryParams, irclickid, approvedNames) {
  if (!isPlainObject(queryParams)) {
    return ["query_params must be an object"];
  }

  const errors = [];
  const approved = approvedNames ? new Set(approvedNames) : null;
  const entries = Object.entries(queryParams);

  if (entries.length > MAX_QUERY_PARAMS) {
    errors.push(`query_params must contain at most ${MAX_QUERY_PARAMS} entries`);
  }

  for (const [name, value] of entries.slice(0, MAX_QUERY_PARAMS)) {
    const label = `query_params.${name.slice(0, MAX_REPORTED_NAME_LENGTH)}`;

    if (!isSafeParamName(name)) {
      errors.push(`${label} is not a valid parameter name`);
    } else if (approved && !approved.has(name)) {
      errors.push(`${label} is not an approved parameter`);
    } else if (typeof value !== "string" || value.length > MAX_PARAM_VALUE_LENGTH) {
      errors.push(`${label} must be a string of at most ${MAX_PARAM_VALUE_LENGTH} characters`);
    }
  }

  if (queryParams.irclickid !== irclickid) {
    errors.push("query_params.irclickid must equal irclickid");
  }

  return errors;
}

/*
 * Validates an event envelope. `stage` is the hop that produced it:
 * "gateway" for Gateway -> Egress A, "egress" for Egress A -> Target.
 */
function validateEventEnvelope(body, { stage, approvedParamNames = null }) {
  const allowedFields = ENVELOPE_FIELDS_BY_STAGE[stage];

  if (!allowedFields) {
    throw new Error(`Unknown envelope stage: ${stage}`);
  }

  if (!isPlainObject(body)) {
    return { errors: ["body must be a JSON object"] };
  }

  const errors = [];
  const unexpected = Object.keys(body).filter((field) => !allowedFields.includes(field));

  if (unexpected.length > 0) {
    errors.push(`unexpected fields: ${summarizeNames(unexpected).join(", ")}`);
  }

  if (body.schema_version !== SCHEMA_VERSION) {
    errors.push(`schema_version must be ${SCHEMA_VERSION}`);
  }

  if (!isValidEventId(body.event_id)) {
    errors.push(`event_id ${EVENT_ID_RULE}`);
  }

  if (!isValidIrclickid(body.irclickid)) {
    errors.push(IRCLICKID_RULE);
  }

  if (typeof body.requester_ip_observed_by_gateway !== "string" || net.isIP(body.requester_ip_observed_by_gateway) === 0) {
    errors.push("requester_ip_observed_by_gateway must be an IPv4 or IPv6 address");
  }

  const timestampFields = allowedFields.filter((field) => field.endsWith("_at"));

  for (const field of timestampFields) {
    if (!isIsoUtcTimestamp(body[field])) {
      errors.push(`${field} must be an ISO-8601 UTC timestamp`);
    }
  }

  errors.push(...validateQueryParamsObject(body.query_params, body.irclickid, approvedParamNames));

  return { errors };
}

/* The URL contract: the configured Target endpoint plus the approved original parameters, in order. */
function buildOutboundUrl(endpointUrl, queryParams) {
  const url = new URL(endpointUrl);

  for (const [name, value] of Object.entries(queryParams)) {
    url.searchParams.append(name, value);
  }

  return url.toString();
}

/* Confirms that the parameters on the request URL are exactly the ones in the signed body. */
function findQueryMismatches(searchParams, expectedParams) {
  const errors = [];
  const urlNames = new Set(searchParams.keys());

  for (const name of urlNames) {
    const label = name.slice(0, MAX_REPORTED_NAME_LENGTH);
    const values = searchParams.getAll(name);

    if (!Object.hasOwn(expectedParams, name)) {
      errors.push(`URL parameter ${label} is not present in query_params`);
    } else if (values.length !== 1 || values[0] !== expectedParams[name]) {
      errors.push(`URL parameter ${label} does not match query_params`);
    }
  }

  for (const name of Object.keys(expectedParams)) {
    if (!urlNames.has(name)) {
      errors.push(`query_params.${name.slice(0, MAX_REPORTED_NAME_LENGTH)} is missing from the URL`);
    }
  }

  return errors;
}

module.exports = {
  SCHEMA_VERSION,
  EVENT_ID_RULE,
  DEFAULT_APPROVED_QUERY_PARAMS,
  isValidEventId,
  normalizeIp,
  parseApprovedParamList,
  extractApprovedQueryParams,
  validateEventEnvelope,
  buildOutboundUrl,
  findQueryMismatches
};
