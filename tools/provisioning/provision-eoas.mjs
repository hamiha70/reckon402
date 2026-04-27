#!/usr/bin/env node
// provision-eoas.mjs — generate reckon402 software EOAs (facilitator,
// seller, buyer-demo ×3) and push their PKs/addresses to Infisical.
//
// Idempotent: a role is skipped if its <ROLE>_PK is already set in
// the target Infisical project/env. Re-runs never clobber existing
// keys.
//
// Implementation per specs/01-eoa-topology.md.
//
// Usage:
//   pnpm -C tools/provisioning eoas
//
// Required environment:
//   INFISICAL_DOMAIN     e.g. https://secrets.intentralabs.com
//   INFISICAL_PROJECT_ID e.g. 84d8a29b-27e3-46d0-bf72-bbe01215ac35
//   INFISICAL_ENV        e.g. dev
//
// Required CLI:
//   infisical (logged in to the right host)

import { spawnSync } from "node:child_process";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROLES = [
  "FACILITATOR",
  "SELLER",
  "BUYER_DEMO_1",
  "BUYER_DEMO_2",
  "BUYER_DEMO_3",
];

const DOMAIN = mustEnv("INFISICAL_DOMAIN");
const PROJECT_ID = mustEnv("INFISICAL_PROJECT_ID");
const ENV = mustEnv("INFISICAL_ENV");

main().catch((err) => {
  console.error(`[provision-eoas] FATAL: ${err.message}`);
  process.exit(1);
});

async function main() {
  const summary = [];
  for (const role of ROLES) {
    const pkKey = `${role}_PK`;
    const addrKey = `${role}_ADDRESS`;
    const existingPk = readSecret(pkKey);
    const existingAddr = readSecret(addrKey);

    if (existingPk && existingAddr) {
      summary.push({ role, action: "SKIP (already set)", address: existingAddr });
      continue;
    }
    if (existingPk && !existingAddr) {
      throw new Error(
        `${pkKey} present but ${addrKey} missing in Infisical — refusing to clobber half-state. Resolve manually.`,
      );
    }
    if (!existingPk && existingAddr) {
      throw new Error(
        `${addrKey} present but ${pkKey} missing in Infisical — refusing to clobber half-state. Resolve manually.`,
      );
    }

    const pk = generatePrivateKey();
    const account = privateKeyToAccount(pk);
    writeSecret(pkKey, pk);
    writeSecret(addrKey, account.address);

    const verifyAddr = readSecret(addrKey);
    if (verifyAddr !== account.address) {
      throw new Error(
        `${addrKey} round-trip mismatch: wrote ${account.address}, read ${verifyAddr}`,
      );
    }
    summary.push({ role, action: "CREATED", address: account.address });
  }

  console.log("\n[provision-eoas] result:");
  console.log("─".repeat(78));
  for (const row of summary) {
    console.log(`  ${row.role.padEnd(14)} ${row.action.padEnd(20)} ${row.address}`);
  }
  console.log("─".repeat(78));
  const created = summary.filter((s) => s.action === "CREATED").length;
  const skipped = summary.filter((s) => s.action.startsWith("SKIP")).length;
  console.log(`  ${created} created, ${skipped} skipped, ${summary.length} total roles`);
  console.log(
    "\n[provision-eoas] PRIVATE KEYS WERE NEVER PRINTED. They live only in Infisical (",
  );
  console.log(`  ${DOMAIN} → project ${PROJECT_ID} → env ${ENV}).`);
  console.log("");
}

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`missing required env var: ${name}`);
  return v;
}

function readSecret(key) {
  const out = spawnSync(
    "infisical",
    [
      "secrets",
      "get",
      key,
      "--projectId",
      PROJECT_ID,
      "--env",
      ENV,
      "--domain",
      DOMAIN,
      "--plain",
      "--silent",
    ],
    { encoding: "utf8" },
  );
  if (out.status !== 0) {
    return "";
  }
  return (out.stdout ?? "").trim();
}

function writeSecret(key, value) {
  const out = spawnSync(
    "infisical",
    [
      "secrets",
      "set",
      `${key}=${value}`,
      "--projectId",
      PROJECT_ID,
      "--env",
      ENV,
      "--domain",
      DOMAIN,
    ],
    { encoding: "utf8" },
  );
  if (out.status !== 0) {
    throw new Error(
      `infisical secrets set ${key} failed (exit=${out.status}): ${out.stderr || out.stdout}`,
    );
  }
}
