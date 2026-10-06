const express = require("express");
const axios = require("axios");

const app = express();

const PORT = process.env.PORT || 3000;
const TARGET_URL =
  process.env.TARGET_URL ||
  "https://ip-egress-lab-1.onrender.com/inspect";

const ALLOWED_GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;

function isAuthorized(req) {
  const token = req.headers["x-gateway-token"];
  return ALLOWED_GATEWAY_TOKEN && token === ALLOWED_GATEWAY_TOKEN;
}

app.get("/", (req, res) => {
  res.json({
    service: "Controlled Egress A",
    status: "ok"
  });
});

app.get("/health", (req, res) => {
  res.json({
    service: "Controlled Egress A",
    status: "healthy"
  });
});

// Temporary lab test.
// This lets us verify which public IP Egress A uses.
app.get("/self-test", async (req, res) => {
  try {
    const response = await axios.get(TARGET_URL, {
      params: {
        test_id: "egress-a-test"
      },
      timeout: 15000
    });

    res.json({
      mode: "egress-a-self-test",
      target: response.data
    });
  } catch (error) {
    console.error(error.message);

    res.status(502).json({
      error: "Egress A could not reach Target",
      message: error.message
    });
  }
});

// Gateway-only proxy endpoint.
app.get("/proxy", async (req, res) => {
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

  try {
    const parsed = new URL(target);

    if (parsed.protocol !== "https:") {
      return res.status(400).json({
        error: "Only HTTPS targets are allowed"
      });
    }

    const response = await axios.get(target, {
  timeout: 15000,
  validateStatus: () => true,
  headers: {
    "User-Agent": "IP-Egress-Lab/1.0",
    "X-Original-Client-IP":
      req.headers["x-original-client-ip"] || "",
    "X-Forwarded-For":
      req.headers["x-forwarded-for"] || ""
  }
});

    res.status(response.status);

    if (typeof response.data === "object") {
      return res.json(response.data);
    }

    return res.send(response.data);
  } catch (error) {
    console.error(error.message);

    return res.status(502).json({
      error: "Egress request failed",
      message: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Egress A listening on ${PORT}`);
});
