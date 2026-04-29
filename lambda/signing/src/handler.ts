import type { APIGatewayProxyEventV2, APIGatewayProxyResultV2 } from "aws-lambda";
import { hashTypedData, type Hex } from "viem";
import { KmsSigner } from "./kms/signer.js";
import { validateSignRequest } from "./validation/schema.js";

// Module-level signer — warm Lambda reuses the cached EOA.
let signer: KmsSigner | null = null;

function getSigner(): KmsSigner {
  if (!signer) {
    const keyId = process.env["KMS_KEY_ID"];
    const region = process.env["AWS_REGION"] ?? "eu-central-1";
    if (!keyId) throw new Error("KMS_KEY_ID env var not set");
    signer = new KmsSigner(keyId, region);
  }
  return signer;
}

function json(statusCode: number, body: unknown): APIGatewayProxyResultV2 {
  return {
    statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
    body: JSON.stringify(body),
  };
}

function checkApiKey(event: APIGatewayProxyEventV2): boolean {
  const expected = process.env["SIGNING_WRAPPER_API_KEY"];
  if (!expected) return false;
  const provided = event.headers?.["x-api-key"] ?? event.headers?.["X-Api-Key"];
  return provided === expected;
}

async function handleSign(event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> {
  if (!checkApiKey(event)) {
    return json(401, { error: "UNAUTHORIZED", message: "missing or invalid X-API-Key" });
  }

  let body: unknown;
  try {
    body = JSON.parse(event.body ?? "{}");
  } catch {
    return json(400, { error: "MALFORMED_BODY", message: "body must be valid JSON" });
  }

  const s = getSigner();
  let pinnedEoa: Hex;
  try {
    pinnedEoa = await s.getEoa();
  } catch (err) {
    return json(502, { error: "KMS_UPSTREAM_FAILURE", message: String(err) });
  }

  const validation = validateSignRequest(body, pinnedEoa, Math.floor(Date.now() / 1000));
  if (!validation.ok) {
    return json(400, { error: validation.code, message: validation.message });
  }

  const { typedData } = validation.data;

  // viem hashTypedData needs the correct structure
  const digest = hashTypedData({
    domain: {
      name:              typedData.domain.name,
      version:           typedData.domain.version,
      chainId:           typedData.domain.chainId,
      verifyingContract: typedData.domain.verifyingContract as Hex,
    },
    types: typedData.types,
    primaryType: "TransferWithAuthorization",
    message: {
      from:        typedData.message.from as Hex,
      to:          typedData.message.to as Hex,
      value:       BigInt(typedData.message.value),
      validAfter:  BigInt(typedData.message.validAfter),
      validBefore: BigInt(typedData.message.validBefore),
      nonce:       typedData.message.nonce as Hex,
    },
  });

  let signature: Hex;
  try {
    signature = await s.sign(digest);
  } catch (err) {
    return json(502, { error: "KMS_UPSTREAM_FAILURE", message: String(err) });
  }

  return json(200, { signature, signerAddress: pinnedEoa });
}

async function handleHealthz(): Promise<APIGatewayProxyResultV2> {
  try {
    const eoa = await getSigner().getEoa();
    return json(200, { status: "ok", kms_reachable: true, signer_eoa: eoa });
  } catch (err) {
    return json(200, { status: "down", kms_reachable: false, error: String(err) });
  }
}

async function handleSigner(): Promise<APIGatewayProxyResultV2> {
  try {
    const eoa = await getSigner().getEoa();
    return json(200, { signerAddress: eoa });
  } catch (err) {
    return json(502, { error: "KMS_UPSTREAM_FAILURE", message: String(err) });
  }
}

export const handler = async (event: APIGatewayProxyEventV2): Promise<APIGatewayProxyResultV2> => {
  const method = event.requestContext.http.method.toUpperCase();
  const path   = event.rawPath;

  if (method === "OPTIONS") {
    return {
      statusCode: 200,
      headers: {
        "Access-Control-Allow-Origin":  "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, X-Api-Key",
      },
      body: "",
    };
  }

  if (path === "/sign" && method === "POST")       return handleSign(event);
  if (path === "/healthz" && method === "GET")     return handleHealthz();
  if (path === "/signer" && method === "GET")      return handleSigner();

  return json(404, { error: "NOT_FOUND", message: `${method} ${path} not found` });
};
