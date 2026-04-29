# Signing Wrapper — Infrastructure

Provisioned manually via AWS CLI with `AWS_PROFILE=intentra`.
Full provisioning runbook: `tools/deploy/deploy-l4b2.md`.

## Resources

| Resource | ID / ARN |
|----------|----------|
| Lambda function | `reckon402-signing-wrapper` |
| Lambda execution role | `reckon402-signing-wrapper-role` |
| KMS key (buyer-signer) | `arn:aws:kms:eu-central-1:975170806362:key/5a0350e0-d502-4579-8d45-d31c843a5f3f` |
| API Gateway HTTP API | `hsnyt8en0a` (eu-central-1) |
| API Gateway custom domain | `signing.reckon402.com` → `d-hvxxmx7mo8.execute-api.eu-central-1.amazonaws.com` |
| ACM certificate | `arn:aws:acm:eu-central-1:975170806362:certificate/436c3ccf-c1cf-415e-aaa0-e90e19524191` |

## IAM policy

Inline policy `reckon402-kms-sign-only` on the execution role:
`kms:Sign` + `kms:GetPublicKey` on the buyer-signer key ARN only.
See `iam-policy.json` for the exact document.

## Env vars on Lambda

| Var | Value |
|-----|-------|
| `KMS_KEY_ID` | `5a0350e0-d502-4579-8d45-d31c843a5f3f` |
| `PINNED_EOA` | `0x46bbb05aca9ea24118b8a57c8d3f317503384305` |
| `SIGNING_WRAPPER_API_KEY` | (from Infisical `reckon402/dev/SIGNING_WRAPPER_API_KEY`) |
