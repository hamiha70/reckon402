#!/usr/bin/env python3
"""
python-recipe.py — Pay agent.reckon402.com/research via signing.reckon402.com/sign

Standalone script using only requests + no Reckon402 packages.

Usage:
    SIGNING_WRAPPER_API_KEY=<key> python3 recipes/python-recipe.py

What you'll see:
    paymentId, state progressing SUBMITTED → CONFIRMED → RECONCILED.
"""

import json
import os
import secrets
import time
import requests

SIGNING_URL    = os.getenv("SIGNING_URL",        "https://signing.reckon402.com/sign")
FACILITATOR    = os.getenv("FACILITATOR_URL",    "https://facilitator.reckon402.com")
MERCHANT_URL   = os.getenv("MERCHANT_URL",       "https://agent.reckon402.com")
PATH           = os.getenv("PATH_TO_GET",        "/research?q=python-recipe")
API_KEY        = os.environ["SIGNING_WRAPPER_API_KEY"]

BUYER_EOA      = "0x46bbb05aca9ea24118b8a57c8d3f317503384305"
SPLITTER       = "0x0ad507c6973eba86313794329ad9b12fbf24acd0"
USDC_SEPOLIA   = "0x036CbD53842c5426634e7929541eC2318f3dCF7e"
CHAIN_ID       = 84532
AMOUNT         = "10000"  # 0.01 USDC

now          = int(time.time())
valid_before = str(now + 600)
nonce        = "0x" + secrets.token_hex(32)

# Step 1: sign via hosted wrapper
print("=== Step 1: Sign EIP-3009 authorization ===")
sign_resp = requests.post(SIGNING_URL, json={
    "typedData": {
        "domain": {
            "name": "USD Coin", "version": "2",
            "chainId": CHAIN_ID, "verifyingContract": USDC_SEPOLIA,
        },
        "types": {"TransferWithAuthorization": [
            {"name": "from",        "type": "address"},
            {"name": "to",          "type": "address"},
            {"name": "value",       "type": "uint256"},
            {"name": "validAfter",  "type": "uint256"},
            {"name": "validBefore", "type": "uint256"},
            {"name": "nonce",       "type": "bytes32"},
        ]},
        "primaryType": "TransferWithAuthorization",
        "message": {
            "from": BUYER_EOA, "to": SPLITTER,
            "value": AMOUNT, "validAfter": "0",
            "validBefore": valid_before, "nonce": nonce,
        },
    }
}, headers={"X-Api-Key": API_KEY}, timeout=10)
sign_resp.raise_for_status()
signature = sign_resp.json()["signature"]
print(f"Signature: {signature[:20]}...")

# Step 2: POST to merchant
print("\n=== Step 2: POST to merchant ===")
auth_header = json.dumps({
    "from": BUYER_EOA, "to": SPLITTER, "value": AMOUNT,
    "validAfter": "0", "validBefore": valid_before, "nonce": nonce,
    "version": 2, "network": f"eip155:{CHAIN_ID}",
})
merchant_resp = requests.get(MERCHANT_URL + PATH, headers={
    "X-PAYMENT-AUTHORIZATION": auth_header,
    "X-PAYMENT-SIGNATURE": signature,
}, timeout=30)

payment_id = merchant_resp.headers.get("x-payment-id") or merchant_resp.json().get("paymentId")
print(f"paymentId: {payment_id}")

# Step 3: poll receipt
print("\n=== Step 3: Poll receipt ===")
state = "SUBMITTED"
while state not in ("RECONCILED", "FAILED"):
    time.sleep(1)
    r = requests.get(f"{FACILITATOR}/x402/receipt/{payment_id}", timeout=10)
    state = r.json().get("state", "UNKNOWN")
    print(f"  {time.strftime('%H:%M:%S')}  state={state}")

print("\nFinal receipt:")
print(json.dumps(r.json(), indent=2))
