#!/usr/bin/env node
// verify-kms-account.mjs — sign+recover round-trip for the KMS account
// adapter. Three offline test cases per specs/02-kms-signer.md §"Test plan":
//
//   1. signMessage     -> verifyMessage
//   2. signTypedData   -> verifyTypedData
//   3. signTransaction -> parseTransaction + secp256k1 recoverPublicKey
//
// All three are offline: no transaction is broadcast, no funded EOA is
// required. A passing run proves the adapter generates byte-correct
// signatures for all three viem entry points and that they recover to
// the KMS-derived address.
//
// Targets are selected by CLI arg (NOT env), to avoid collision with
// Infisical-hydrated KMS_* env vars that name the *buyer-signer* slot.
//
// Usage:
//
//   node verify-kms-account.mjs                # both targets in sequence
//   node verify-kms-account.mjs deployer       # only deployer
//   node verify-kms-account.mjs buyer-signer   # only buyer-signer
//
// Recommended invocation (hydrated from Infisical):
//
//   unset AWS_PROFILE && \
//   infisical run --env dev \
//     --projectId 84d8a29b-27e3-46d0-bf72-bbe01215ac35 \
//     --domain https://secrets.intentralabs.com \
//     -- node tools/sign/verify-kms-account.mjs
//
// The aws.sh probe only proves a 32-byte digest can be signed and
// recovered; this script proves the full viem LocalAccount surface
// works for the three message types reckon402 actually emits.

import {
  parseTransaction,
  recoverMessageAddress,
  recoverTypedDataAddress,
  toBytes,
} from "viem";
import { secp256k1 } from "@noble/curves/secp256k1";
import { keccak_256 } from "@noble/hashes/sha3";

import { kmsAccount } from "./kms-account.mjs";

// Two locked targets. Each target carries its own AWS creds slot in
// Infisical (so verifying with least-privilege per IAM user works).
//
//   deployer      -> reckon402-deployer IAM user  -> DEPLOYER_AWS_*
//   buyer-signer  -> reckon402-signer   IAM user  -> AWS_*
//
// EOAs hard-coded; cross-checked against tools/smoke-tests/lib/kms-verify.mjs
// and the AGENTS.md "KMS resources" lock table.
const TARGETS = {
  deployer: {
    alias: "alias/reckon402/mainnet/deployer/evm",
    expectedAddress: "0x66c2858d9a8605957c516a77262eb66ee6be113c",
    awsAccessKeyEnv: "DEPLOYER_AWS_ACCESS_KEY_ID",
    awsSecretEnv: "DEPLOYER_AWS_SECRET_ACCESS_KEY",
  },
  "buyer-signer": {
    alias: "alias/reckon402/mainnet/buyer-signer/evm",
    expectedAddress: "0x46bbb05aca9ea24118b8a57c8d3f317503384305",
    awsAccessKeyEnv: "AWS_ACCESS_KEY_ID",
    awsSecretEnv: "AWS_SECRET_ACCESS_KEY",
  },
};

const REGION = process.env.AWS_REGION || "eu-central-1";

const argTarget = process.argv[2];
const targetsToRun = argTarget
  ? [argTarget]
  : ["deployer", "buyer-signer"];
for (const t of targetsToRun) {
  if (!(t in TARGETS)) {
    console.error(
      `verify-kms-account: unknown target "${t}". Use one of: ${Object.keys(TARGETS).join(", ")}`,
    );
    process.exit(2);
  }
}

/**
 * Snapshot AWS_* env, swap in the per-target slot, run a thunk, then
 * restore. The default AWS SDK credential chain reads from the env
 * vars on client construction, so each kmsAccount() call sees the
 * credentials we pin for that target.
 */
async function withAwsCreds(target, thunk) {
  const prev = {
    ak: process.env.AWS_ACCESS_KEY_ID,
    sk: process.env.AWS_SECRET_ACCESS_KEY,
  };
  const ak = process.env[target.awsAccessKeyEnv];
  const sk = process.env[target.awsSecretEnv];
  if (!ak || !sk) {
    throw new Error(
      `verify-kms-account: ${target.awsAccessKeyEnv}/${target.awsSecretEnv} not present in env (did you forget infisical run?)`,
    );
  }
  process.env.AWS_ACCESS_KEY_ID = ak;
  process.env.AWS_SECRET_ACCESS_KEY = sk;
  try {
    return await thunk();
  } finally {
    process.env.AWS_ACCESS_KEY_ID = prev.ak;
    process.env.AWS_SECRET_ACCESS_KEY = prev.sk;
  }
}

function fail(msg) {
  console.error(`FAIL ${msg}`);
  process.exit(1);
}

function pass(msg) {
  console.log(`  ok ${msg}`);
}

function assertAddressEq(label, got, want) {
  const a = got.toLowerCase();
  const b = want.toLowerCase();
  if (a !== b) fail(`${label}: got ${a}, want ${b}`);
  pass(`${label} -> ${a}`);
}

async function caseSignMessage(account, expectedAddress) {
  const message = `reckon402 KMS signer ownership proof ${new Date().toISOString().slice(0, 10)}`;
  const signature = await account.signMessage({ message });
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) {
    fail(`signMessage: signature shape invalid: ${signature}`);
  }
  const recovered = await recoverMessageAddress({ message, signature });
  assertAddressEq("signMessage", recovered, expectedAddress);
}

async function caseSignTypedData(account, expectedAddress) {
  const typedData = {
    domain: {
      name: "reckon402",
      version: "1",
      chainId: 84532,
    },
    types: {
      Probe: [
        { name: "label", type: "string" },
        { name: "nonce", type: "uint256" },
      ],
    },
    primaryType: "Probe",
    message: {
      label: "kms-account verify",
      nonce: BigInt(Date.now()),
    },
  };
  const signature = await account.signTypedData(typedData);
  if (!/^0x[0-9a-f]{130}$/i.test(signature)) {
    fail(`signTypedData: signature shape invalid: ${signature}`);
  }
  const recovered = await recoverTypedDataAddress({ ...typedData, signature });
  assertAddressEq("signTypedData", recovered, expectedAddress);
}

async function caseSignTransaction(account, expectedAddress) {
  // Minimal EIP-1559 tx on Base Sepolia (chainId 84532). Values are
  // dummies; the test only proves the signature recovers to the
  // expected EOA, not that the tx would be accepted by a node.
  const tx = {
    chainId: 84532,
    type: "eip1559",
    nonce: 0,
    maxFeePerGas: 1_000_000_000n, // 1 gwei
    maxPriorityFeePerGas: 1_000_000_000n,
    gas: 21_000n,
    to: "0x0000000000000000000000000000000000000000",
    value: 0n,
    data: "0x",
  };

  const rawSigned = await account.signTransaction(tx);
  if (!/^0x[0-9a-f]+$/i.test(rawSigned)) {
    fail(`signTransaction: raw tx shape invalid`);
  }

  // viem's parseTransaction returns the signed tx object including
  // r, s, yParity. We hash the unsigned form and recover the public key
  // via @noble — this is the same path Geth/Reth use to determine
  // sender for an EIP-1559 tx.
  const parsed = parseTransaction(rawSigned);
  if (!parsed.r || !parsed.s || parsed.yParity === undefined) {
    fail(`signTransaction: parsed tx missing signature fields`);
  }

  // Reconstruct the unsigned-tx hash (sighash) by stripping signature
  // fields and re-serializing. parseTransaction gives us a clean
  // object to hand back to viem's serializer.
  const unsignedFields = { ...parsed };
  delete unsignedFields.r;
  delete unsignedFields.s;
  delete unsignedFields.yParity;
  delete unsignedFields.v;
  // Re-import locally to avoid pulling viem.serializeTransaction into
  // the module top-level (caseSignTransaction is the only caller).
  const { serializeTransaction } = await import("viem");
  const unsignedRaw = serializeTransaction(unsignedFields);
  const sighash = keccak_256(toBytes(unsignedRaw));

  // Recover the public key; secp256k1.Signature wants r||s in compact
  // form plus a recovery bit (0 or 1).
  const rHex = parsed.r.slice(2).padStart(64, "0");
  const sHex = parsed.s.slice(2).padStart(64, "0");
  const compact = new Uint8Array(
    (rHex + sHex).match(/.{2}/g).map((b) => parseInt(b, 16)),
  );
  const sig = secp256k1.Signature.fromCompact(compact).addRecoveryBit(
    Number(parsed.yParity),
  );
  const pub = sig.recoverPublicKey(sighash).toRawBytes(false); // 0x04 || X || Y
  const recoveredAddr =
    "0x" +
    Buffer.from(keccak_256(pub.slice(1))).toString("hex").slice(-40);

  assertAddressEq("signTransaction", recoveredAddr, expectedAddress);
}

async function runTarget(name) {
  const target = TARGETS[name];
  const expected = target.expectedAddress.toLowerCase();
  const t0 = Date.now();

  console.log(
    `\nverify-kms-account [${name}]: alias=${target.alias} region=${REGION} expect=${expected}`,
  );

  await withAwsCreds(target, async () => {
    const account = await kmsAccount({ keyAlias: target.alias, region: REGION });
    if (account.address.toLowerCase() !== expected) {
      fail(
        `${name}: address derivation mismatch: account.address=${account.address.toLowerCase()} expect=${expected}`,
      );
    }
    pass(`address derivation -> ${account.address.toLowerCase()}`);

    await caseSignMessage(account, expected);
    await caseSignTypedData(account, expected);
    await caseSignTransaction(account, expected);
  });

  const dur = Date.now() - t0;
  console.log(`PASS verify-kms-account [${name}] ${dur}ms`);
}

async function main() {
  const overall_t0 = Date.now();
  for (const name of targetsToRun) {
    await runTarget(name);
  }
  console.log(
    `\nALL PASS verify-kms-account ${Date.now() - overall_t0}ms (${targetsToRun.length} target${targetsToRun.length === 1 ? "" : "s"})`,
  );
}

main().catch((err) => {
  fail(err.message || String(err));
});
