"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const {
  DEFAULT_APPROVED_QUERY_PARAMS,
  normalizeIp,
  parseApprovedParamList,
  extractApprovedQueryParams,
  validateEventEnvelope,
  buildOutboundUrl,
  findQueryMismatches
} = require("../shared/eventContract");
const { buildGatewayEvent, buildEgressEvent } = require("../test-support");

describe("normalizeIp", () => {
  it("unwraps IPv4-mapped IPv6 addresses", () => {
    assert.equal(normalizeIp("::ffff:203.0.113.9"), "203.0.113.9");
  });

  it("keeps IPv6 addresses and rejects non-addresses", () => {
    assert.equal(normalizeIp("2001:db8::1"), "2001:db8::1");
    assert.equal(normalizeIp("not-an-ip"), null);
    assert.equal(normalizeIp(undefined), null);
  });
});

describe("parseApprovedParamList", () => {
  it("falls back to the default list when unset", () => {
    assert.deepEqual(parseApprovedParamList(undefined), DEFAULT_APPROVED_QUERY_PARAMS);
  });

  it("requires irclickid to stay approved", () => {
    assert.throws(() => parseApprovedParamList("utm_source"), /must include irclickid/);
  });

  it("refuses prototype-polluting names", () => {
    assert.throws(() => parseApprovedParamList("irclickid,__proto__"), /invalid names: __proto__/);
  });
});

describe("extractApprovedQueryParams", () => {
  const approved = ["irclickid", "utm_source"];

  it("separates approved, control and ignored parameters", () => {
    const result = extractApprovedQueryParams(
      new URLSearchParams("irclickid=abc&test_id=t-1&utm_source=x&gclid=y"),
      approved,
      ["test_id"]
    );

    assert.deepEqual(result, { params: { irclickid: "abc", utm_source: "x" }, ignored: ["gclid"], errors: [] });
  });

  it("rejects over-long values", () => {
    const result = extractApprovedQueryParams(
      new URLSearchParams({ irclickid: "abc", utm_source: "x".repeat(513) }),
      approved
    );

    assert.deepEqual(result.errors, ["utm_source must be at most 512 characters"]);
  });

  it("bounds the ignored-name report", () => {
    const query = Array.from({ length: 30 }, (_, index) => `${"n".repeat(100)}${index}=1`).join("&");
    const result = extractApprovedQueryParams(new URLSearchParams(`irclickid=abc&${query}`), approved);

    assert.equal(result.ignored.length, 20);
    assert.ok(result.ignored.every((name) => name.length === 64));
  });
});

describe("validateEventEnvelope", () => {
  it("accepts a well-formed envelope for each stage", () => {
    assert.deepEqual(validateEventEnvelope(buildGatewayEvent(), { stage: "gateway" }), { errors: [] });
    assert.deepEqual(validateEventEnvelope(buildEgressEvent(), { stage: "egress" }), { errors: [] });
  });

  it("rejects egress-only fields at the gateway stage", () => {
    const { errors } = validateEventEnvelope(buildEgressEvent(), { stage: "gateway" });

    assert.deepEqual(errors, ["unexpected fields: egress_forwarded_at"]);
  });

  it("reports every invalid field", () => {
    const { errors } = validateEventEnvelope(
      buildGatewayEvent({
        schema_version: 2,
        event_id: "short",
        requester_ip_observed_by_gateway: "999.1.1.1",
        gateway_received_at: "yesterday"
      }),
      { stage: "gateway" }
    );

    assert.equal(errors.length, 4);
  });

  it("rejects non-object bodies", () => {
    assert.deepEqual(validateEventEnvelope([], { stage: "gateway" }), { errors: ["body must be a JSON object"] });
  });
});

describe("URL contract", () => {
  it("appends the approved parameters to the configured endpoint in order", () => {
    assert.equal(
      buildOutboundUrl("https://target.example.com/v1/events", { irclickid: "abc", utm_campaign: "a b&c" }),
      "https://target.example.com/v1/events?irclickid=abc&utm_campaign=a+b%26c"
    );
  });

  it("round-trips through findQueryMismatches without differences", () => {
    const params = { irclickid: "abc", utm_campaign: "a b&c/ü" };
    const url = new URL(buildOutboundUrl("https://target.example.com/v1/events", params));

    assert.deepEqual(findQueryMismatches(url.searchParams, params), []);
  });

  it("reports added, missing and changed parameters", () => {
    const errors = findQueryMismatches(new URLSearchParams("irclickid=changed&extra=1"), {
      irclickid: "abc",
      utm_source: "x"
    });

    assert.deepEqual(errors, [
      "URL parameter irclickid does not match query_params",
      "URL parameter extra is not present in query_params",
      "query_params.utm_source is missing from the URL"
    ]);
  });
});
