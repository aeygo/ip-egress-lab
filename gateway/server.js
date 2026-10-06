const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;

const TARGET_URL = process.env.TARGET_URL;
const EGRESS_TARGET_URL =
  process.env.EGRESS_TARGET_URL ||
  "https://ip-egress-lab-1.onrender.com/inspect";

function generateTestId() {
  return crypto.randomBytes(16).toString("hex");
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];

  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }

  return (
    req.headers["x-real-ip"] ||
    req.socket?.remoteAddress ||
    null
  );
}

app.get("/", (req, res) => {
  res.json({
    service: "Controlled IP Egress Gateway",
    status: "ok",
    version: "2.0",
    endpoints: [
      "/",
      "/direct",
      "/egress-ip"
    ]
  });
});

app.get("/egress-ip", async (req, res) => {
  try {
    const response = await axios.get(
      "https://api.ipify.org?format=json",
      {
        timeout: 10000
      }
    );

    res.json({
      service: "Controlled IP Egress Gateway",
      egress_ip: response.data.ip
    });
  } catch (error) {
    console.error("egress-ip error:", error.message);

    res.status(502).json({
      error: "Could not determine egress IP",
      message: error.message
    });
  }
});

app.get("/direct", async (req, res) => {
  const testId = generateTestId();
  const customerIp = getClientIp(req);

  if (!TARGET_URL) {
    return res.status(500).json({
      error: "TARGET_URL is not configured"
    });
  }

  try {
    /*
     * Gateway → Egress A
     *
     * TARGET_URL should point to:
     * https://ip-egress-lab-3.onrender.com/proxy
     */

    const response = await axios.get(TARGET_URL, {
      params: {
        url: EGRESS_TARGET_URL,
        test_id: testId
      },

      headers: {
        "X-Original-Client-IP": customerIp || "",
        "X-Forwarded-For": customerIp || "",
        "X-Gateway-Token":
          process.env.EGRESS_TOKEN || ""
      },

      timeout: 20000,

      validateStatus: () => true
    });

    console.log("Gateway → Egress A status:", response.status);
    console.log("Gateway → Egress A response:", response.data);

    if (response.status >= 400) {
      return res.status(502).json({
        error: "Egress A returned an error",
        upstream_status: response.status,
        upstream_response: response.data,
        test_id: testId,
        customer_ip_detected_by_gateway: customerIp
      });
    }

    res.json({
      mode: "gateway-egress-a-target",

      test_id: testId,

      customer_ip_detected_by_gateway:
        customerIp,

      gateway: {
        service: "Gateway",
        status: "ok"
      },

      egress: {
        service: "Egress A",
        status: "ok"
      },

      target: response.data
    });

  } catch (error) {
    console.error(
      "Gateway /direct error:",
      error.message
    );

    return res.status(502).json({
      error: "Gateway could not reach Egress A",
      message: error.message,
      test_id: testId,
      customer_ip_detected_by_gateway: customerIp
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(
    `Gateway listening on port ${PORT}`
  );
});
