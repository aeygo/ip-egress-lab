"use strict";

/*
 * Render cannot read files outside a service's root directory, so each service carries
 * its own copy of the shared modules it needs under <service>/src/shared/.
 *
 *   node scripts/sync-shared.js          copy shared/ into each service
 *   node scripts/sync-shared.js --check  exit 1 if any copy differs from shared/
 */

const fs = require("node:fs");
const path = require("node:path");

const REPO_ROOT = path.resolve(__dirname, "..");
const SHARED_DIR = path.join(REPO_ROOT, "shared");

const COMMON_MODULES = [
  "bootstrap.js",
  "configHelpers.js",
  "eventContract.js",
  "logger.js",
  "responses.js",
  "signing.js"
];

const SERVICE_MODULES = {
  gateway: [...COMMON_MODULES, "signedClient.js"],
  "egress-a": [...COMMON_MODULES, "signedClient.js", "signedServer.js"],
  target: [...COMMON_MODULES, "signedServer.js"]
};

function serviceSharedDir(service) {
  return path.join(REPO_ROOT, service, "src", "shared");
}

function listJsFiles(directory) {
  return fs.existsSync(directory)
    ? fs.readdirSync(directory).filter((file) => file.endsWith(".js"))
    : [];
}

function findDrift() {
  const drift = [];

  for (const [service, modules] of Object.entries(SERVICE_MODULES)) {
    const directory = serviceSharedDir(service);

    for (const file of modules) {
      const copyPath = path.join(directory, file);
      const canonical = fs.readFileSync(path.join(SHARED_DIR, file), "utf8");

      if (!fs.existsSync(copyPath) || fs.readFileSync(copyPath, "utf8") !== canonical) {
        drift.push(`${service}/src/shared/${file} differs from shared/${file}`);
      }
    }

    for (const file of listJsFiles(directory)) {
      if (!modules.includes(file)) {
        drift.push(`${service}/src/shared/${file} is not listed for ${service}`);
      }
    }
  }

  return drift;
}

function sync() {
  for (const [service, modules] of Object.entries(SERVICE_MODULES)) {
    const directory = serviceSharedDir(service);
    fs.mkdirSync(directory, { recursive: true });

    for (const file of listJsFiles(directory)) {
      if (!modules.includes(file)) {
        fs.rmSync(path.join(directory, file));
      }
    }

    for (const file of modules) {
      fs.copyFileSync(path.join(SHARED_DIR, file), path.join(directory, file));
    }

    console.log(`${service}: synced ${modules.length} shared modules`);
  }
}

if (process.argv.includes("--check")) {
  const drift = findDrift();

  if (drift.length > 0) {
    console.error(`Shared modules are out of sync. Run \`npm run sync:shared\`.\n- ${drift.join("\n- ")}`);
    process.exitCode = 1;
  } else {
    console.log("Shared modules are in sync.");
  }
} else {
  sync();
}
