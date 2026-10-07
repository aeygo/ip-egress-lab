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
    version: "2.1",
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
    service:
      "Controlled Egress A",

    status:
      "healthy"
  });
});

app.get("/self-test", async (req, res) => {
  try {
    const response =
      await axios.get(
        DEFAULT_TARGET_URL,
        {
          params: {
            test_id:
              "egress-a-self-test"
          },

          timeout: 15000,

          validateStatus:
            () => true
        }
      );

    res
      .status(response.status)
      .json({
        mode:
          "egress-a-self-test",

        target:
          response.data
      });

  } catch (error) {
    console.error(
      "Self-test error:",
      error.message
    );

    res.status(502).json({
      error:
        "Egress A could not reach Target",

      message:
        error.message
    });
  }
});

app.get("/proxy", async (req, res) => {

  if (!isAuthorized(req)) {
    return res.status(403).json({
      error:
        "Unauthorized"
    });
  }

  const target =
    req.query.url;

  if (!target) {
    return res.status(400).json({
      error:
        "Missing url"
    });
  }

  let parsed;

  try {
    parsed =
      new URL(target);

  } catch (error) {
    return res.status(400).json({
      error:
        "Invalid target URL"
    });
  }

  if (parsed.protocol !== "https:") {
    return res.status(400).json({
      error:
        "Only HTTPS targets are allowed"
    });
  }

  const customerIp =
    req.headers[
      "x-original-client-ip"
    ] || "";

  const forwardedFor =
    req.headers[
      "x-forwarded-for"
    ] || "";

  /*
   * Preserve all incoming query
   * parameters except the internal
   * routing parameter "url".
   */
  const forwardedParams = {};

  Object.keys(req.query)
    .forEach((key) => {

      if (key !== "url") {
        forwardedParams[key] =
          req.query[key];
      }

    });

  try {

    console.log(
      "Egress A target:",
      target
    );

    console.log(
      "Egress A customer IP:",
      customerIp
    );

    console.log(
      "Egress A forwarded params:",
      forwardedParams
    );

    const response =
      await axios.get(
        target,
        {
          params:
            forwardedParams,

          timeout:
            20000,

          validateStatus:
            () => true,

          headers: {

            "User-Agent":
              "IP-Egress-Lab/2.1",

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

    if (response.status >= 400) {

      return res.status(502).json({
        error:
          "Target returned an error",

        target:
          target,

        target_status:
          response.status,

        target_response:
          response.data,

        customer_ip:
          customerIp,

        forwarded_parameters:
          forwardedParams
      });

    }

    return res
      .status(response.status)
      .json(response.data);

  } catch (error) {

    console.error(
      "Egress A proxy error:",
      error.message
    );

    return res.status(502).json({

      error:
        "Egress request failed",

      message:
        error.message,

      target:
        target,

      customer_ip:
        customerIp,

      forwarded_parameters:
        forwardedParams
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
