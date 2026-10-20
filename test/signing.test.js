"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { createSignatureHeader, verifySignature } = require("../shared/signing");

const SECRET = "unit-test-secret-0123456789abcdef0123";
const BODY = JSON.stringify({ event_id: "evt-0001" });
const NOW = 1_800_000_000;

function verify(overrides) {
  return verifySignature({
    secret: SECRET,
    header: createSignatureHeader(SECRET, BODY, NOW),
    rawBody: BODY,
    nowSeconds: NOW,
    ...overrides
  });
}

describe("request signing", () => {
  it("accepts a signature over the exact body within the tolerance window", () => {
    assert.deepEqual(verify({ nowSeconds: NOW + 299 }), { valid: true, reason: null });
  });

  it("rejects a body changed after signing", () => {
    assert.equal(verify({ rawBody: BODY.replace("0001", "0002") }).reason, "signature_mismatch");
  });

  it("rejects a signature made with a different secret", () => {
    assert.equal(verify({ secret: `${SECRET}-other` }).reason, "signature_mismatch");
  });

  it("rejects a signature outside the tolerance window in either direction", () => {
    assert.equal(verify({ nowSeconds: NOW + 301 }).reason, "stale_signature");
    assert.equal(verify({ nowSeconds: NOW - 301 }).reason, "stale_signature");
  });

  it("distinguishes a missing header from a malformed one", () => {
    assert.equal(verify({ header: undefined }).reason, "missing_signature");
    assert.equal(verify({ header: "t=abc,v1=zz" }).reason, "malformed_signature");
    assert.equal(verify({ header: `t=${NOW},v1=${"a".repeat(63)}` }).reason, "malformed_signature");
  });
});
