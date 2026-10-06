const express = require("express");
const axios = require("axios");
const crypto = require("crypto");

const app = express();

const PORT = process.env.PORT || 3000;
const TARGET_URL = process.env.TARGET_URL;

function generateTestId() {
  return crypto.randomBytes(16).toString("hex");
}

app.get("/", (req, res) => {
  res.json({
    service: "Controlled IP Egress Gateway",
    status: "ok",
    endpoints: [
      "/direct",
      "/test?egress=A",
      "/test?egress=B"
    ]
  });
});

app.get("/direct", async (req, res) => {
  const testId = generateTestId();

  try {
    const response = await axios.get(TARGET_URL, {
      params: {
        test_id: testId
      },
      timeout: 15000
    });

    res.json({
      mode: "direct",
      test_id: testId,
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
