const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.get("/", (req, res) => {
  res.json({
    service: "IP Egress Lab Target",
    status: "ok",
    version: "2.0"
  });
});

app.get("/inspect", (req, res) => {

  const forwardedFor =
    req.headers["x-forwarded-for"] || "";

  const forwardedIps =
    forwardedFor
      .split(",")
      .map(ip => ip.trim())
      .filter(Boolean);

  const result = {

    timestamp:
      new Date().toISOString(),

    /*
     * This is the immediate network connection
     * seen by the application.
     *
     * On Render this can be an internal proxy,
     * so do not treat it as the original customer IP.
     */
    network_source_ip:
      req.socket?.remoteAddress || null,

    /*
     * Application-level customer IP
     * forwarded by our Gateway/Egress chain.
     */
    customer_ip:
      req.headers["x-original-client-ip"] || null,

    /*
     * Forwarding chain observed by Target.
     */
    forwarded_for:
      req.headers["x-forwarded-for"] || null,

    forwarded_ip_list:
      forwardedIps,

    /*
     * The second entry is useful in this
     * controlled Render experiment, but the
     * exact infrastructure-generated entries
     * should not be interpreted as universal
     * public-IP semantics.
     */
    observed_gateway_ip:
      forwardedIps.length > 1
        ? forwardedIps[1]
        : null,

    real_ip:
      req.headers["x-real-ip"] || null,

    test_id:
      req.query.test_id || null,

    user_agent:
      req.headers["user-agent"] || null,

    host:
      req.headers["host"] || null
  };

  console.log(
    JSON.stringify(result)
  );

  res.json(result);
});

app.listen(
  PORT,
  "0.0.0.0",
  () => {
    console.log(
      `IP Egress Lab Target listening on port ${PORT}`
    );
  }
);
