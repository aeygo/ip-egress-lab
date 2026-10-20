"use strict";

/*
 * Canonical source: shared/signing.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 *
 * Service-to-service authentication. The sender signs `${timestamp}.${rawBody}` with
 * HMAC-SHA256 and sends `X-Lab-Signature: t=<unix seconds>,v1=<hex digest>`.
 * The timestamp bounds replay of a captured request to the tolerance window.
 */

const crypto = require("node:crypto");

const SIGNATURE_HEADER = "x-lab-signature";
const SIGNATURE_SCHEME = "v1";
const DEFAULT_TOLERANCE_SECONDS = 300;
const MAX_HEADER_LENGTH = 256;
const HEX_DIGEST_PATTERN = /^[a-f0-9]{64}$/;

function currentUnixSeconds() {
  return Math.floor(Date.now() / 1000);
}

function computeSignature(secret, timestamp, rawBody) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function createSignatureHeader(secret, rawBody, timestamp = currentUnixSeconds()) {
  return `t=${timestamp},${SIGNATURE_SCHEME}=${computeSignature(secret, timestamp, rawBody)}`;
}

function parseSignatureHeader(header) {
  if (typeof header !== "string" || header.length > MAX_HEADER_LENGTH) {
    return null;
  }

  const fields = new Map(
    header.split(",").map((part) => {
      const separator = part.indexOf("=");
      return separator === -1
        ? [part.trim(), ""]
        : [part.slice(0, separator).trim(), part.slice(separator + 1).trim()];
    })
  );

  const timestamp = Number(fields.get("t"));
  const signature = fields.get(SIGNATURE_SCHEME) ?? "";

  if (!Number.isSafeInteger(timestamp) || !HEX_DIGEST_PATTERN.test(signature)) {
    return null;
  }

  return { timestamp, signature };
}

function verifySignature({
  secret,
  header,
  rawBody,
  toleranceSeconds = DEFAULT_TOLERANCE_SECONDS,
  nowSeconds = currentUnixSeconds()
}) {
  const parsed = parseSignatureHeader(header);

  if (!parsed) {
    return { valid: false, reason: header ? "malformed_signature" : "missing_signature" };
  }

  if (Math.abs(nowSeconds - parsed.timestamp) > toleranceSeconds) {
    return { valid: false, reason: "stale_signature" };
  }

  const expected = Buffer.from(computeSignature(secret, parsed.timestamp, rawBody), "hex");
  const received = Buffer.from(parsed.signature, "hex");

  if (!crypto.timingSafeEqual(expected, received)) {
    return { valid: false, reason: "signature_mismatch" };
  }

  return { valid: true, reason: null };
}

module.exports = {
  SIGNATURE_HEADER,
  DEFAULT_TOLERANCE_SECONDS,
  createSignatureHeader,
  verifySignature
};
