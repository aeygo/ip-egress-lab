"use strict";

const HTML_ESCAPES = Object.freeze({
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => HTML_ESCAPES[character]);
}

/* All values come from request headers or query parameters and must be escaped. */
function renderTestPage({ customerIp, networkSourceIp, testId }) {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>IP Egress Lab Test</title>
    <style>
      body {
        font-family: Arial, sans-serif;
        max-width: 700px;
        margin: 60px auto;
        padding: 20px;
        background: #f5f5f5;
      }
      h1 { margin-bottom: 30px; }
      .box {
        background: white;
        border: 1px solid #ddd;
        border-radius: 10px;
        padding: 25px;
      }
      .row { margin-bottom: 24px; }
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
        <div class="label">Website Tracking IP</div>
        <div class="value">${escapeHtml(customerIp)}</div>
      </div>
      <div class="row">
        <div class="label">Network Source IP</div>
        <div class="value">${escapeHtml(networkSourceIp)}</div>
      </div>
      <div class="row">
        <div class="label">Test ID</div>
        <div class="value">${escapeHtml(testId)}</div>
      </div>
      <div class="note">
        Website Tracking IP is the unverified X-Original-Client-IP header on this request.
        Network Source IP is the connection source resolved through the trusted proxy hops.
      </div>
    </div>
  </body>
</html>`;
}

module.exports = { escapeHtml, renderTestPage };
