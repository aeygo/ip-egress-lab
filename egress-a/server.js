const express = require("express");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;

const DEFAULT_TARGET_URL =
  process.env.TARGET_URL ||
  "https://ip-egress-lab-1.onrender.com/inspect";

const GATEWAY_TOKEN =
  process.env.GATEWAY_TOKEN;

function isAuthorized(req) {
  const token =
    req.headers["x-gateway-token"];

  return (
    GATEWAY_TOKEN &&
    token === GATEWAY_TOKEN
  );
}

app.get("/", (req, res) => {
  res.json({
    service: "Controlled Egress A",
    status: "ok",
    version: "2.0",
    endpoints: [
      "/",
      "/health",
      "/self-test",
      "/proxy"
    ]
  });
});

app.get("/health", (req, res) => {
  res.json({
    service: "Controlled Egress A",
    status: "healthy"
  });
});

/*
 * Direct Egress A → Target test
 */
app.get("/self-test", async (req, res) => {
  try {
    const response = await axios.get(
      DEFAULT_TARGET_URL,
      {
        params: {
          test_id: "egress-a-self-test"
        },

        timeout: 15000,

        validateStatus: () => true
      }
    );

    res.status(response.status).json({
      mode: "egress-a-self-test",
      target: response.data
    });

  } catch (error) {
    console.error(
      "Self-test error:",
      error.message
    );

    res.status(502).json({
      error: "Egress A could not reach Target",
      message: error.message
    });
  }
});

/*
 * Gateway → Egress A → Target
 */
app.get("/proxy", async (req, res) => {

  /*
   * Only Gateway is allowed to use this endpoint.
   */
  if (!isAuthorized(req)) {
    return res.status(403).json({
      error: "Unauthorized"
    });
  }

  const target = req.query.url;

  if (!target) {
    return res.status(400).json({
      error: "Missing url"
    });
  }

  let parsed;

  try {
    parsed = new URL(target);
  } catch (error) {
    return res.status(400).json({
      error: "Invalid target URL"
    });
  }

  /*
   * Lab only allows HTTPS destinations.
   */
  if (parsed.protocol !== "https:") {
    return res.status(400).json({
      error: "Only HTTPS targets are allowed"
    });
  }

  /*
   * Customer IP metadata received from Gateway.
   */
  const customerIp =
    req.headers["x-original-client-ip"] || "";

  const forwardedFor =
    req.headers["x-forwarded-for"] || "";

  try {

    /*
     * Egress A → Target
     *
     * The actual network request originates
     * from Egress A.
     *
     * Customer IP is preserved only as
     * application-level metadata.
     */
    const response = await axios.get(
      target,
      {
        params: {
          test_id:
            req.query.test_id || ""
        },

        timeout: 20000,

        validateStatus: () => true,

        headers: {
          "User-Agent":
            "IP-Egress-Lab/2.0",

          "X-Original-Client-IP":
            customerIp,

          "X-Forwarded-For":
            forwardedFor
        }
      }
    );

    console.log(
      "Egress A → Target status:",
      response.status
    );

    console.log(
      "Customer IP metadata:",
      customerIp
    );

    /*
     * Return Target response to Gateway.
     */
    res.status(response.status);

    if (
      response.data !== null &&
      typeof response.data === "object"
    ) {
      return res.json(response.data);
    }

    return res.send(response.data);

  } catch (error) {

    console.error(
      "Proxy error:",
      error.message
    );

    return res.status(502).json({
      error: "Egress request failed",
      message: error.message
    });
  }
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `Egress A listening on port ${PORT}`
    );
  }
);
