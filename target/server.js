const express = require("express");

const app = express();

const PORT = process.env.PORT || 3000;

app.set("trust proxy", true);

app.get("/", (req, res) => {
  res.json({
    service: "IP Egress Lab Target",
    status: "ok",
    version: "2.1",
    endpoints: [
      "/",
      "/inspect",
      "/test-page"
    ]
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

  const customerIp =
    req.headers["x-original-client-ip"] || null;

  const result = {

    timestamp:
      new Date().toISOString(),

    /*
     * Immediate network connection seen by
     * the Target application.
     *
     * This is NOT the customer IP.
     */
    network_source_ip:
      req.socket?.remoteAddress || null,

    /*
     * Customer IP detected by Gateway and
     * forwarded through our controlled lab.
     */
    customer_ip:
      customerIp,

    /*
     * The IP that our controlled website
     * should associate with this visitor.
     */
    website_tracking_ip:
      customerIp,

    /*
     * Forwarding chain observed by Target.
     */
    forwarded_for:
      req.headers["x-forwarded-for"] || null,

    forwarded_ip_list:
      forwardedIps,

    /*
     * Useful only for this controlled Render
     * experiment. Do not interpret this as
     * universal public-IP semantics.
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


/*
 * CONTROLLED WEBSITE TEST PAGE
 *
 * This page demonstrates that the website can
 * read the customer IP forwarded by our Gateway.
 */
app.get("/test-page", (req, res) => {

  const customerIp =
    req.headers["x-original-client-ip"] ||
    "Unknown";

  const testId =
    req.query.test_id ||
    "No test ID";

  const networkSourceIp =
    req.socket?.remoteAddress ||
    "Unknown";

  res.send(`
    <!DOCTYPE html>

    <html>
      <head>

        <meta charset="UTF-8">

        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        >

        <title>IP Egress Lab Test</title>

        <style>

          body {
            font-family: Arial, sans-serif;
            max-width: 700px;
            margin: 60px auto;
            padding: 20px;
            background: #f5f5f5;
          }

          h1 {
            margin-bottom: 30px;
          }

          .box {
            background: white;
            border: 1px solid #ddd;
            border-radius: 10px;
            padding: 25px;
          }

          .row {
            margin-bottom: 24px;
          }

          .label {
            font-size: 14px;
            color: #666;
            margin-bottom: 7px;
          }

          .value {
            font-family: monospace;
            font-size: 18px;
            word-break: break-all;
          }

          .note {
            margin-top: 25px;
            padding: 15px;
            background: #f0f0f0;
            border-radius: 8px;
            font-size: 14px;
            line-height: 1.5;
          }

        </style>

      </head>

      <body>

        <h1>IP Egress Lab</h1>

        <div class="box">

          <div class="row">
            <div class="label">
              Website Tracking IP
            </div>

            <div class="value">
              ${customerIp}
            </div>
          </div>


          <div class="row">
            <div class="label">
              Network Source IP
            </div>

            <div class="value">
              ${networkSourceIp}
            </div>
          </div>


          <div class="row">
            <div class="label">
              Test ID
            </div>

            <div class="value">
              ${testId}
            </div>
          </div>


          <div class="note">
            Website Tracking IP is the customer IP
            forwarded by the controlled Gateway.
            Network Source IP is the immediate
            connection seen by the Target service.
          </div>

        </div>

      </body>
    </html>
  `);
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
