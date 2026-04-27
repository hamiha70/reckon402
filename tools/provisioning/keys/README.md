# reckon402 KMS public keys

PEM-encoded public keys for the two project-scoped AWS KMS keys
(spec `ECC_SECG_P256K1` = secp256k1, used as Ethereum hot wallets).
The keys themselves are non-exportable HSM material; only these
public-key blobs leave AWS.

Both PEMs are committed for **OSS reproducibility**: a hackathon
judge can re-derive the EOA without any AWS credentials by running:

```bash
node tools/provisioning/derive-eoa-from-pem.mjs tools/provisioning/keys/<role>.pem
```

The script parses the SubjectPublicKeyInfo DER, extracts the
uncompressed point, keccak256s the X || Y bytes, and takes the last
20 bytes as the EOA. No AWS calls.

## Keys

### buyer-signer

| Field | Value |
|-------|-------|
| Alias | `alias/reckon402/mainnet/buyer-signer/evm` |
| Key ID | `5a0350e0-d502-4579-8d45-d31c843a5f3f` |
| ARN | `arn:aws:kms:eu-central-1:975170806362:key/5a0350e0-d502-4579-8d45-d31c843a5f3f` |
| Spec | `ECC_SECG_P256K1` |
| Derived EOA | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` |
| PEM | `buyer-signer.pem` |
| Captured | 2026-04-27 |

### deployer

| Field | Value |
|-------|-------|
| Alias | `alias/reckon402/mainnet/deployer/evm` |
| Key ID | `5b6e7c40-49e8-42cf-80a3-c22d52d3f40a` |
| ARN | `arn:aws:kms:eu-central-1:975170806362:key/5b6e7c40-49e8-42cf-80a3-c22d52d3f40a` |
| Spec | `ECC_SECG_P256K1` |
| Derived EOA | `0x66c2858d9a8605957c516a77262eb66ee6be113c` |
| PEM | `deployer.pem` |
| Captured | 2026-04-27 |

## How to refresh from KMS

If KMS aliases ever rotate (they should not — these are immutable
identities), refresh with:

```bash
for role in buyer-signer deployer; do
  AWS_PROFILE=intentra aws kms get-public-key \
    --region eu-central-1 \
    --key-id "alias/reckon402/mainnet/${role}/evm" \
    --output text --query 'PublicKey' \
  | { echo "-----BEGIN PUBLIC KEY-----"; fold -w 64; echo "-----END PUBLIC KEY-----"; } \
  > tools/provisioning/keys/${role}.pem
done
```

The `kms:GetPublicKey` action is included in both the
`reckon402-mainnet-buyer-signer-kms-policy` and the
`reckon402-mainnet-deployer-kms-policy` IAM policies, so each
scoped IAM user can read its own key. Cross-key reads require the
`intentra-admin` break-glass profile.
