const express = require("express");

const app = express();

const PORT =
  process.env.PORT || 3000;

app.set(
  "trust proxy",
  true
);

app.get("/", (req, res) => {
  res.json({
    service:
      "IP Egress Lab Target",

    status:
      "ok",

    version:
      "2.2",

    endpoints: [
      "/",
      "/inspect",
      "/test-page"
    ]
  });
});

app.get("/inspect", (req, res) => {

  const forwardedFor =
    req.headers[
      "x-forwarded-for"
    ] || "";

  const forwardedIps =
    forwardedFor
      .split(",")
      .map(ip => ip.trim())
      .filter(Boolean);

  const customerIp =
    req.headers[
      "x-original-client-ip"
    ] || null;

  const result = {

    timestamp:
      new Date().toISOString(),

    /*
     * Immediate network connection
     * seen by the Target application.
     */
    network_source_ip:
      req.socket?.remoteAddress ||
      null,

    /*
     * Customer IP carried as
     * application-level metadata.
     */
    customer_ip:
      customerIp,

    /*
     * Website tracking IP used
     * by this controlled lab.
     */
    website_tracking_ip:
      customerIp,

    forwarded_for:
      req.headers[
        "x-forwarded-for"
      ] || null,

    forwarded_ip_list:
      forwardedIps,

    observed_gateway_ip:
      forwardedIps.length > 1
        ? forwardedIps[1]
        : null,

    real_ip:
      req.headers[
        "x-real-ip"
      ] || null,

    /*
     * Complete query string
     * received by Target.
     */
    query_parameters:
      req.query,

    /*
     * Individual parameters
     * for easy inspection.
     */
    irclickid:
      req.query.irclickid ||
      null,

    lab_click_id:
      req.query.lab_click_id ||
      null,

    irgwc:
      req.query.irgwc ||
      null,

    utm_source:
      req.query.utm_source ||
      null,

    utm_medium:
      req.query.utm_medium ||
      null,

    utm_campaign:
      req.query.utm_campaign ||
      null,

    utm_content:
      req.query.utm_content ||
      null,

    lab_gateway_test_id:
      req.query.lab_gateway_test_id ||
      null,

    test_id:
      req.query.test_id ||
      null,

    user_agent:
      req.headers[
        "user-agent"
      ] || null,

    host:
      req.headers[
        "host"
      ] || null
  };

  console.log(
    JSON.stringify(result)
  );

  res.json(result);
});

/*
 * Controlled website test page.
 */
app.get("/test-page", (req, res) => {

  const customerIp =
    req.headers[
      "x-original-client-ip"
    ] || "Unknown";

  const testId =
    req.query.lab_gateway_test_id ||
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

        <title>
          IP Egress Lab Test
        </title>

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

        <h1>
          IP Egress Lab
        </h1>

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

            Website Tracking IP is the
            customer IP forwarded by the
            controlled Gateway.

            Network Source IP is the
            immediate connection seen by
            the Target service.

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
