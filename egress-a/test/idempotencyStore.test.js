"use strict";

const { describe, it } = require("node:test");
const assert = require("node:assert/strict");
const { IdempotencyStore } = require("../src/services/idempotencyStore");

function createStore({ ttlMs = 1000, maxEntries = 100 } = {}) {
  const clock = { now: 0 };
  const store = new IdempotencyStore({ ttlMs, maxEntries, now: () => clock.now });
  return { store, clock };
}

describe("IdempotencyStore", () => {
  it("claims a new key and reports it as in flight until completed", () => {
    const { store } = createStore();

    assert.deepEqual(store.claim("event-1", "fp"), { outcome: "claimed" });
    assert.deepEqual(store.claim("event-1", "fp"), { outcome: "in_flight" });
  });

  it("returns the stored response once completed", () => {
    const { store } = createStore();
    const response = { statusCode: 200, body: { success: true } };

    store.claim("event-1", "fp");
    store.complete("event-1", response);

    assert.deepEqual(store.claim("event-1", "fp"), { outcome: "completed", response });
  });

  it("reports a conflict when the same key arrives with a different fingerprint", () => {
    const { store } = createStore();

    store.claim("event-1", "fp-a");

    assert.deepEqual(store.claim("event-1", "fp-b"), { outcome: "conflict" });
  });

  it("forgets a released key so it can be claimed again", () => {
    const { store } = createStore();

    store.claim("event-1", "fp");
    store.release("event-1");

    assert.deepEqual(store.claim("event-1", "fp"), { outcome: "claimed" });
  });

  it("expires entries after the TTL", () => {
    const { store, clock } = createStore({ ttlMs: 1000 });

    store.claim("event-1", "fp");
    store.complete("event-1", { statusCode: 200, body: {} });
    clock.now = 1000;

    assert.deepEqual(store.claim("event-1", "fp"), { outcome: "claimed" });
  });

  it("evicts the oldest entry when full", () => {
    const { store } = createStore({ maxEntries: 2 });

    store.claim("event-1", "fp");
    store.claim("event-2", "fp");
    store.claim("event-3", "fp");

    assert.equal(store.size, 2);
    assert.deepEqual(store.claim("event-1", "fp"), { outcome: "claimed" });
  });
});
