"use strict";

/*
 * Canonical source: shared/configHelpers.js
 * Copied into <service>/src/shared/ by `npm run sync:shared`. Edit this file, not the copies.
 *
 * Reads environment variables, collecting every problem so a misconfigured
 * deployment fails at startup with one complete message.
 */

const net = require("node:net");
const { parseApprovedParamList, DEFAULT_APPROVED_QUERY_PARAMS } = require("./eventContract");

const MIN_SECRET_LENGTH = 32;
const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "[::1]"]);

class ConfigError extends Error {
  constructor(problems) {
    super(`Invalid configuration:\n- ${problems.join("\n- ")}`);
    this.name = "ConfigError";
    this.problems = problems;
  }
}

function isAllowedEndpointProtocol(url) {
  return url.protocol === "https:" || (url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname));
}

function createConfigReader(env) {
  const problems = [];

  function isUnset(name) {
    return env[name] === undefined || env[name].trim() === "";
  }

  return {
    problem(message) {
      problems.push(message);
    },

    secret(name) {
      const value = env[name];

      if (typeof value !== "string" || value.length < MIN_SECRET_LENGTH) {
        problems.push(`${name} must be set to a secret of at least ${MIN_SECRET_LENGTH} characters`);
        return null;
      }

      return value;
    },

    integer(name, { defaultValue, min, max, hint = "" }) {
      if (isUnset(name)) {
        if (defaultValue === undefined) {
          problems.push(`${name} is required${hint}`);
          return null;
        }
        return defaultValue;
      }

      const raw = env[name].trim();
      const value = Number(raw);

      if (!/^\d+$/.test(raw) || value < min || value > max) {
        problems.push(`${name} must be an integer between ${min} and ${max}${hint}`);
        return defaultValue ?? null;
      }

      return value;
    },

    ipAddress(name, defaultValue) {
      if (isUnset(name)) {
        return defaultValue;
      }

      const value = env[name].trim();

      if (net.isIP(value) === 0) {
        problems.push(`${name} must be an IPv4 or IPv6 address`);
        return defaultValue;
      }

      return value;
    },

    /* An absolute https URL (http only for loopback) with no credentials, query or fragment. */
    endpointUrl(name) {
      if (isUnset(name)) {
        problems.push(`${name} is required`);
        return null;
      }

      let url;

      try {
        url = new URL(env[name].trim());
      } catch {
        problems.push(`${name} must be an absolute URL`);
        return null;
      }

      if (!isAllowedEndpointProtocol(url)) {
        problems.push(`${name} must use https (http is allowed only for localhost)`);
      }

      if (url.username || url.password) {
        problems.push(`${name} must not contain credentials`);
      }

      if (url.search || url.hash) {
        problems.push(`${name} must not contain a query string or fragment`);
      }

      return url.toString();
    },

    approvedQueryParams(name) {
      try {
        return parseApprovedParamList(env[name]);
      } catch (error) {
        problems.push(error.message);
        return DEFAULT_APPROVED_QUERY_PARAMS;
      }
    },

    assertValid() {
      if (problems.length > 0) {
        throw new ConfigError(problems);
      }
    }
  };
}

module.exports = { ConfigError, createConfigReader };
