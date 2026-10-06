const express = require("express");
const axios = require("axios");
const net = require("net");

const app = express();

const PORT = process.env.PORT || 3000;
const ALLOWED_GATEWAY_TOKEN = process.env.GATEWAY_TOKEN;

app.use(express.json());

function isAuthorized(req) {
  if (!ALLOWED_GATEWAY_TOKEN) return false;

  const token = req.headers["x-gateway-token"];

  return token === ALLOWED_GATEWAY_TOKEN;
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

    // For this lab, only allow HTTPS targets.
    if (parsed.protocol !== "https:") {
      return res.status(400).json({
        error: "Only HTTPS targets are allowed"
      });
    }

    const response = await axios.get(target, {
      timeout: 15000,
      validateStatus: () => true,
      headers: {
        "User-Agent": "IP-Egress-Lab/1.0"
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
  console.log(`Egress A listening on port ${PORT}`);
});
