"use strict";

/*
 * In-memory idempotency for event IDs. Suits the single Egress A instance on EC2;
 * entries are lost on restart, so Target may see a replayed event after a restart.
 *
 * Every entry gets the same TTL at claim time, so Map insertion order is also expiry
 * order and eviction can stop at the first live entry.
 */
class IdempotencyStore {
  #entries = new Map();
  #ttlMs;
  #maxEntries;
  #now;

  constructor({ ttlMs, maxEntries, now = Date.now }) {
    this.#ttlMs = ttlMs;
    this.#maxEntries = maxEntries;
    this.#now = now;
  }

  /*
   * Returns { outcome } where outcome is:
   *   "claimed"   - first time this key is seen; the caller must complete() or release()
   *   "in_flight" - the same event is being processed right now
   *   "completed" - already delivered; `response` holds the stored result
   *   "conflict"  - the key was used with a different payload fingerprint
   */
  claim(key, fingerprint) {
    this.#evictExpired();
    const existing = this.#entries.get(key);

    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        return { outcome: "conflict" };
      }

      return existing.state === "completed"
        ? { outcome: "completed", response: existing.response }
        : { outcome: "in_flight" };
    }

    this.#evictOldestWhileFull();
    this.#entries.set(key, {
      state: "in_flight",
      fingerprint,
      response: null,
      expiresAt: this.#now() + this.#ttlMs
    });

    return { outcome: "claimed" };
  }

  complete(key, response) {
    const entry = this.#entries.get(key);

    if (entry) {
      entry.state = "completed";
      entry.response = response;
    }
  }

  release(key) {
    this.#entries.delete(key);
  }

  get size() {
    return this.#entries.size;
  }

  #evictExpired() {
    const now = this.#now();

    for (const [key, entry] of this.#entries) {
      if (entry.expiresAt > now) {
        break;
      }
      this.#entries.delete(key);
    }
  }

  #evictOldestWhileFull() {
    while (this.#entries.size >= this.#maxEntries) {
      this.#entries.delete(this.#entries.keys().next().value);
    }
  }
}

module.exports = { IdempotencyStore };
