# L1 Deploy Run Log — 2026-04-27

## Environment

- Wrangler: 4.85.0 (workspace dep in workers/agent)
- Node: 22 (WSL2, Ubuntu)
- pnpm: 9.15.0
- Worker: `reckon402-agent`
- Custom domain: `agent.reckon402.com`
- Deployed via: `infisical run ... -- bash -c 'cd workers/agent && pnpm wrangler deploy'`

---

## 1. Unit tests (vitest)

```
> @reckon402/agent@0.0.1 test
> vitest run

 RUN  v3.2.4 .../workers/agent

 ✓ test/index.test.ts (3 tests) 8ms

 Test Files  1 passed (1)
      Tests  3 passed (3)
   Duration  347ms
```

**Result: 3/3 PASS**

---

## 2. Deploy output

```
 ⛅️ wrangler 4.85.0
───────────────────
Total Upload: 62.58 KiB / gzip: 15.29 KiB
Uploaded reckon402-agent (3.11 sec)
Deployed reckon402-agent triggers (4.50 sec)
  agent.reckon402.com (custom domain)
Current Version ID: 0c091a8b-72a2-4eb6-9677-b01900dec2f1
```

Custom domain auto-provisioned on first deploy. No pre-existing A/CNAME
record was required (Custom Domain mode vs. Zone Routes).

---

## 3. Integration test (`tools/integration-tests/agent.sh`)

```
=== agent.reckon402.com integration test (L1) ===
Target: https://agent.reckon402.com

PASS GET /health → 200 + ok
PASS GET /research?q= → 200 + agent name
PASS GET /research (no q) → 400
PASS GET / → 200

Results: 4 passed, 0 failed
PASS agent.reckon402.com integration test
```

**Result: 4/4 PASS** (exit code 0)

---

## 4. wrangler tail excerpt

Two requests captured during integration run (`outcome: ok` on both):

```json
{
  "outcome": "ok",
  "scriptName": "reckon402-agent",
  "scriptVersion": { "id": "0c091a8b-72a2-4eb6-9677-b01900dec2f1" },
  "wallTime": 3, "cpuTime": 2,
  "event": {
    "request": {
      "url": "https://agent.reckon402.com/research?q=wrangler-tail-probe",
      "method": "GET"
    },
    "response": { "status": 200 }
  }
}
```

```json
{
  "outcome": "ok",
  "scriptName": "reckon402-agent",
  "scriptVersion": { "id": "0c091a8b-72a2-4eb6-9677-b01900dec2f1" },
  "wallTime": 2, "cpuTime": 2,
  "event": {
    "request": {
      "url": "https://agent.reckon402.com/health",
      "method": "GET"
    },
    "response": { "status": 200 }
  }
}
```

Colo: FRA (Frankfurt). TLS 1.3. HTTP/2.

---

## 5. Live verification

```
$ curl https://agent.reckon402.com/research?q=test
{
  "query": "test",
  "summary": "This is a stub response. Real research is coming in a future layer.",
  "agent": "reckon402-demo-research",
  "layer": "L1"
}
```

---

## DOD checklist

- [x] `specs/02-l1-agent-stub.md` committed (commit 1: dab39ca)
- [x] `workers/agent/` tree committed (commit 2: 63a0833)
- [x] 3/3 vitest unit tests pass
- [x] `wrangler deploy` succeeded; custom domain `agent.reckon402.com` live
- [x] `tools/integration-tests/agent.sh` exits 0 (4/4 assertions)
- [x] `wrangler tail` captures at least one request log line (see §4)
- [x] `curl https://agent.reckon402.com/research?q=test` returns 200 + canned JSON
