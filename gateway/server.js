"use strict";

const { loadConfig } = require("./src/config");
const { createApp } = require("./src/app");
const { startService } = require("./src/shared/bootstrap");

startService({ service: "gateway", loadConfig, createApp });
