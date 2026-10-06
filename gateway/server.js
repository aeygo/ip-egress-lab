const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const TARGET_URL = process.env.TARGET_URL;

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
    endpoints: [
      "/direct"
    ]
  });
});

app.get("/direct", async (req, res) => {
  const testId = generateTestId();
  const customerIp = getClientIp(req);

  try {
    const response = await axios.get(TARGET_URL, {
      params: {
        test_id: testId
      },
      headers: {
        "X-Original-Client-IP": customerIp || "",
        "X-Forwarded-For": customerIp || ""
      },
      timeout: 15000
    });

    res.json({
      mode: "direct",
      test_id: testId,
      customer_ip_detected_by_gateway: customerIp,
      target: response.data
    });

  } catch (error) {
    console.error(error.message);

    res.status(502).json({
      error: error.message
    });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Gateway listening on ${PORT}`);
});
