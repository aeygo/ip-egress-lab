const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.get("/", (req, res) => {
  res.json({
    service: "IP Egress Lab Target",
    status: "ok",
    version: "1.0.0"
  });
});

app.get("/inspect", (req, res) => {
  const result = {
    timestamp: new Date().toISOString(),

    // Actual network connection reaching this Target
    network_source_ip:
      req.socket?.remoteAddress || null,

    // IP explicitly forwarded by our Gateway
    customer_ip:
      req.headers["x-original-client-ip"] || null,

        // Observed second entry in the forwarding chain.
    // In this Render lab, this is the Gateway's observed public egress IP.
    observed_gateway_ip:
      (req.headers["x-forwarded-for"] || "")
        .split(",")
        .map(ip => ip.trim())[1] || null,

    // Forwarded chain
    forwarded_for:
      req.headers["x-forwarded-for"] || null,

    real_ip:
      req.headers["x-real-ip"] || null,

    test_id:
      req.query.test_id || null,

    user_agent:
      req.headers["user-agent"] || null,

    host:
      req.headers["host"] || null
  };

  console.log(JSON.stringify(result));

  res.json(result);
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`IP Egress Lab Target listening on port ${PORT}`);
});
