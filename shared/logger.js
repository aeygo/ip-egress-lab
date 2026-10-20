"use strict";

/*
 * Canonical source: shared/logger.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 *
 * One JSON object per line so logs from all three services can be joined on event_id.
 * Callers must never pass secrets or signature headers as fields.
 */

function writeToStdout(line) {
  process.stdout.write(`${line}\n`);
}

function createLogger({ service, write = writeToStdout }) {
  function log(level, event, fields = {}) {
    write(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        service,
        event,
        ...fields
      })
    );
  }

  return {
    info: (event, fields) => log("info", event, fields),
    warn: (event, fields) => log("warn", event, fields),
    error: (event, fields) => log("error", event, fields)
  };
}

module.exports = { createLogger };
