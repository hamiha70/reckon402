export default {
  fetch(request) {
    const url = new URL(request.url);

    if (url.pathname === '/healthz') {
      return new Response(
        JSON.stringify({ status: 'ok', surface: 'landing', timestamp: Date.now() }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }

    if (url.pathname === '/ens') {
      return new Response(JSON.stringify({
        track: 'ENS',
        tagline: 'Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back. The trust signal drives history-aware behavior — for this hackathon, a per-agent on-chain Escrow that holds funds against future claims and releases as on-chain reputation grows.',
        evidence: [
          {
            item: 'Reckon402Resolver deployed on Ethereum Sepolia',
            address: '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
            tx: '0xb658d064556f217be83f322f9800f19dcc07bff61a6dde22f85d7fa28edc945f',
            block: 10749903
          },
          {
            item: 'ENS reckon402-test.eth resolver set to Reckon402Resolver via setResolver',
            tx: '0xc852b44767e2318d24ac024f83e2be9342f2e25bdfe566157cdcf076519bf975',
            block: 10750233
          },
          {
            item: 'x402.* text records served via CCIP-Read: x402.facilitator, x402.splitter, x402.amount, x402.erc8004.agent_id',
            gateway: 'https://gateway.reckon402.com',
            ensName: 'seller11.reckon402-test.eth'
          },
          {
            item: 'Gateway-enforced ACL: SellingAgent-owned keys (x402.amount, x402.pricing, x402.endpoint) vs Reckon402-owned keys (x402.splitter, x402.facilitator, x402.erc8004.registry, x402.erc8004.agent_id)',
            spec: 'specs/08b-l4c-onboarding.md'
          },
          {
            item: 'CCIP-Read flow: Resolver emits OffchainLookup, client fetches gateway.reckon402.com, D1-backed record returned with signature, on-chain verification completes',
            resolver: '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
            gateway: 'https://gateway.reckon402.com'
          }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    if (url.pathname === '/keeperhub') {
      return new Response(JSON.stringify({
        track: 'KeeperHub',
        tagline: 'Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back. The trust signal drives history-aware behavior — for this hackathon, a per-agent on-chain Escrow that holds funds against future claims and releases as on-chain reputation grows.',
        evidence: [
          {
            item: 'KH workflow recipe: importable workflow definition for autonomous x402 buyer flow',
            artifact: 'recipes/kh-workflow.json'
          },
          {
            item: 'Signing wrapper: AWS Lambda + KMS endpoint for EIP-712 typed-data (workaround for KH sandbox limitation)',
            url: 'https://signing.reckon402.com',
            healthz: 'https://signing.reckon402.com/healthz'
          },
          {
            item: '@reckon402/kh-skill npm package',
            package: '@reckon402/kh-skill',
            source: 'packages/kh-skill/'
          },
          {
            item: 'Builder feedback: 4 concrete gaps filed in FEEDBACK.md',
            artifact: 'FEEDBACK.md',
            gaps: [
              'In-sandbox EIP-712 typed-data signing is a hard blocker for x402 buyer flows',
              'ERC-8004 endpoint is not shipped (404 during verification pass)',
              'Payment receipt loop is fire-and-forget (no wait_for_receipt primitive)',
              'Documentation gap on the buyer side (examples are mostly merchant-side)'
            ]
          },
          {
            item: 'End-to-end: KH workflow wallet authenticates via Turnkey TEE; signing wrapper signs x402 PaymentAuthorizations via KMS buyer-signer',
            khWallet: '0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4',
            signerEOA: '0x46bbb05aca9ea24118b8a57c8d3f317503384305'
          }
        ]
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    }

    const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="56" height="56" role="img" aria-label="Reckon402 logo">
  <title>Reckon402</title>
  <path d="M14 28 L26 40 L50 16" fill="none" stroke="#22D67B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="14" y="46" width="36" height="3.5" rx="1.5" fill="#22D67B"/>
  <rect x="14" y="52" width="26" height="3.5" rx="1.5" fill="#22D67B" opacity="0.65"/>
  <rect x="14" y="58" width="16" height="3.5" rx="1.5" fill="#22D67B" opacity="0.35"/>
</svg>`;

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reckon402 — Agent commerce with memory.</title>
  <meta name="description" content="Agent commerce with memory. Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back."/>
  <script src="https://cdn.tailwindcss.com"><\/script>
  <style>
    body { font-family: 'JetBrains Mono', 'Fira Mono', 'Courier New', monospace; }
    .card-hover { transition: border-color 0.15s, box-shadow 0.15s; }
    .card-hover:hover { border-color: #4ade80 !important; box-shadow: 0 0 0 1px #4ade8022; }
    .arch-box { border: 1px solid #1f2937; background: #030712; border-radius: 8px; padding: 1.5rem; overflow-x: auto; white-space: pre; font-size: 12px; line-height: 1.7; color: #6b7280; }
    .arch-box .hl { color: #4ade80; }
    .arch-box .dim { color: #374151; }
    .arch-box .blue { color: #60a5fa; }
    .arch-box .amber { color: #fbbf24; }
    .arch-box .purpl { color: #c4b5fd; }
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .npm-badge { display: inline-flex; align-items: center; gap: 6px; background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 3px 10px; font-size: 11px; color: #9ca3af; text-decoration: none; }
    .npm-badge:hover { border-color: #374151; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen px-4 py-12">
  <div class="max-w-6xl mx-auto space-y-12">

    <!-- HERO -->
    <header class="space-y-5 pb-8 border-b border-gray-800">
      <div class="flex items-center gap-5">
        <div class="shrink-0">${logoSvg}</div>
        <div>
          <h1 class="text-3xl font-bold tracking-tight">
            <span class="text-white">Reckon</span><span class="text-green-400">402</span>
          </h1>
        </div>
      </div>
      <h2 class="text-3xl sm:text-4xl font-bold text-white leading-tight tracking-tight">Agent commerce with memory.</h2>
      <p class="text-gray-300 text-base leading-relaxed max-w-2xl">
        Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back.
      </p>
      <div class="flex flex-col sm:flex-row gap-3 pt-1">
        <a href="https://app.reckon402.com"
           class="bg-green-500 hover:bg-green-400 text-gray-950 font-bold py-3 px-8 rounded-lg text-center text-sm transition-colors">
          Launch App
        </a>
        <a href="https://github.com/hamiha70/reckon402"
           target="_blank" rel="noopener"
           class="bg-gray-800 hover:bg-gray-700 text-gray-100 font-bold py-3 px-8 rounded-lg text-center text-sm transition-colors border border-gray-700">
          GitHub
        </a>
      </div>
    </header>

    <!-- INTRO: problem + closed loop, side by side -->
    <section class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div>
        <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">The problem</h2>
        <p class="text-gray-300 text-sm leading-relaxed mb-3">
          x402, ENS, ERC-8004, USDC — none of them closes the loop. A buyer
          paying a seller it has never met has:
        </p>
        <ul class="text-gray-300 text-sm leading-relaxed space-y-2 list-none">
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>no on-chain history to read</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>no escrow held against bad delivery</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>no path to revoke a payment</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>no primitive for risk-weighted routing or investable revenue claims</span></li>
        </ul>
      </div>
      <div>
        <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">The closed loop</h2>
        <p class="text-gray-300 text-sm leading-relaxed mb-3">
          Reckon402 closes it.
        </p>
        <ul class="text-gray-300 text-sm leading-relaxed space-y-2 list-none">
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>Every x402 payment writes a facilitator-signed ERC-8004 attestation on-chain</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>Every ENS resolution reads it back through CCIP-Read — a verifiable <strong class="text-white">trust signal</strong></span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>The signal drives a <strong class="text-white">per-agent on-chain Escrow</strong>: low reputation holds a buffer, high reputation releases the payment</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">›</span><span>Escrow is NFT-bound to IdentityRegistry — the buffer follows ownership</span></li>
        </ul>
      </div>
    </section>

    <!-- BUILT / COMING NEXT -->
    <section class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div>
        <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Built in this hackathon</h2>
        <ul class="text-gray-300 text-sm leading-relaxed space-y-2 list-none">
          <li class="flex gap-2"><span class="text-green-400 shrink-0">+</span><span>Facilitator-signed ERC-8004 attestation on every confirmed settlement</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">+</span><span>CCIP-Read ENS gateway that returns the trust count</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">+</span><span><code class="text-green-300 bg-gray-900 px-1 rounded">SplitterFactory</code> + <code class="text-green-300 bg-gray-900 px-1 rounded">EscrowFactory</code> with per-agent contracts</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">+</span><span>Pluggable, parameterized <code class="text-green-300 bg-gray-900 px-1 rounded">ITierStrategy</code> curve</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">+</span><span>NFT-bound withdraw — Escrow follows IdentityRegistry ownership</span></li>
          <li class="flex gap-2"><span class="text-green-400 shrink-0">+</span><span>Fork-tested against live ERC-8004 contracts on Base Sepolia</span></li>
        </ul>
      </div>
      <div>
        <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Coming next</h2>
        <ul class="text-gray-300 text-sm leading-relaxed space-y-2 list-none">
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">›</span><span>Buyer-side proof-of-non-delivery (zkTLS via Reclaim Protocol)</span></li>
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">›</span><span>Negative attestation that unlocks Escrow withdrawal back to the buyer</span></li>
          <li class="flex gap-2"><span class="text-amber-400 shrink-0">›</span><span>Other history-aware adaptations are consumer-side and drop in directly: tier pricing, risk-weighted routing, optimistic-vs-strict handling, investable-agent revenue claims</span></li>
        </ul>
      </div>
    </section>

    <!-- ARCHITECTURE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Architecture</h2>
      <p class="text-gray-400 text-xs leading-relaxed max-w-3xl mb-4">
        Two flows. <strong class="text-white">Onboarding</strong> happens once per
        SellingAgent and provisions ENS, ERC-8004, Splitter and Escrow.
        <strong class="text-white">Purchase</strong> happens per HTTP call and
        feeds the trust loop.
        <span class="text-amber-400">Base Sepolia</span> hosts the value rails;
        <span class="text-purple-300">Ethereum Sepolia</span> hosts the ENS namespace.
      </p>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">

        <div class="arch-box">
<span class="blue">ONBOARDING</span> <span class="dim">— one-time per SellingAgent</span>

Operator runs:
   <span class="hl">just onboard-l4d</span> &lt;ens&gt; &lt;eoa&gt;     <span class="dim">CLI</span>
   <span class="hl">app.reckon402.com</span>                  <span class="dim">form UI</span>
                <span class="dim">│</span>
                <span class="dim">▼</span>
   <span class="hl">onboard-orchestrator</span> drives 6 steps:

   1. ENS subname mint
        seller{N}.reckon402-test.eth
        <span class="purpl">on Ethereum Sepolia</span>

   2. ERC-8004 agentId register
        <span class="hl">IdentityRegistry</span>.newAgent
        <span class="amber">on Base Sepolia</span>

   3. <span class="hl">EscrowFactory</span>.createEscrow <span class="dim">(CREATE2)</span>
        per-agent Escrow, agentId-keyed
        wired to v1 <span class="hl">TierStrategy</span>

   4. <span class="hl">SplitterFactory</span>.createSplitter <span class="dim">(CREATE2)</span>
        recipients <span class="dim">=</span> [seller, fac-fee, Escrow]
        BPS        <span class="dim">=</span> [ 8700,    300,   1000 ]

   5. Sign + write ENS records via gateway
        <span class="dim">x402.splitter   x402.escrow</span>
        <span class="dim">x402.amount     x402.facilitator</span>
        <span class="dim">x402.endpoint   x402.erc8004.agent_id</span>

   6. ENS setOwner(subnode, sellerEoa)
        closes Reckon402 bootstrap-write window

   <span class="hl">Agent is live and paywalled.</span></div>

        <div class="arch-box">
<span class="blue">PURCHASE</span> <span class="dim">— per HTTP call, 3 on-chain txs</span>

<span class="hl">BuyingAgent</span>  →  <span class="hl">agent</span>.reckon402.com  <span class="dim">(GET)</span>
                <span class="dim">│</span>
                <span class="dim">▼ 402 + x402 PaymentRequirements</span>

BuyingAgent signs EIP-3009 typed-data:
   <span class="hl">@reckon402/buyer-sdk</span> <span class="dim">locally</span>, or
   <span class="hl">signing.reckon402.com</span> <span class="dim">(KMS+Lambda)</span>
                <span class="dim">│</span>
                <span class="dim">▼ X-Payment header</span>

agent  →  <span class="hl">facilitator</span>  <span class="dim">(/x402/settle)</span>

facilitator <span class="amber">on Base Sepolia</span> sends 3 txs:

   <span class="blue">tx 1 · settle</span>
     resolve x402.splitter via gateway
     <span class="amber">USDC</span>.transferWithAuthorization
     buyer → per-agent Splitter

   <span class="blue">tx 2 · distribute</span>
     per-agent <span class="hl">Splitter</span>.distribute
     87% → seller EOA
     3%  → facilitator fee EOA
     10% → per-agent Escrow

   <span class="blue">tx 3 · attest</span>
     <span class="hl">ReputationRegistry</span>.giveFeedback
     one attestation, facilitator-signed
     gateway cache invalidated

All three render live on the dashboard
under <span class="hl">app.reckon402.com</span>.

<span class="dim">─── trust loop ──────────────────────────</span>

Next call from any buyer:
   gateway re-reads ERC-8004 → trust count
   tier walks T0 → T1 → T2 ... as count grows
   withdrawableNow rises in per-agent Escrow

Seller (NFT owner of agentId), any time:
   <span class="hl">Escrow</span>.withdrawAll()  <span class="dim">via Claim button</span>
   gated on <span class="hl">IdentityRegistry</span>.ownerOf(agentId)</div>

      </div>
    </section>

    <!-- LIVE SERVICES + SDKS -->
    <section class="grid grid-cols-1 md:grid-cols-2 gap-8">
      <div>
        <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-4">Live services</h2>
        <ul class="space-y-3 text-sm">
          <li class="flex items-start gap-3">
            <span id="dot-agent" class="dot bg-gray-600 mt-2 shrink-0"></span>
            <div>
              <div class="text-white font-bold">agent.reckon402.com</div>
              <div class="text-gray-500 text-xs">x402-paywalled merchant agent (Hono + <code class="text-gray-400">withX402</code>)</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span id="dot-app" class="dot bg-gray-600 mt-2 shrink-0"></span>
            <div>
              <div class="text-white font-bold">app.reckon402.com</div>
              <div class="text-gray-500 text-xs">SellingAgent onboarding flow + per-agent dashboard</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span id="dot-facilitator" class="dot bg-gray-600 mt-2 shrink-0"></span>
            <div>
              <div class="text-white font-bold">facilitator.reckon402.com</div>
              <div class="text-gray-500 text-xs">x402 verify + settle Worker (D1, ERC-8004 attestation writes)</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span id="dot-gateway" class="dot bg-gray-600 mt-2 shrink-0"></span>
            <div>
              <div class="text-white font-bold">gateway.reckon402.com</div>
              <div class="text-gray-500 text-xs">CCIP-Read ENS gateway (D1, ERC-8004 reads, signed off-chain records)</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span id="dot-signing" class="dot bg-gray-600 mt-2 shrink-0"></span>
            <div>
              <div class="text-white font-bold">signing.reckon402.com</div>
              <div class="text-gray-500 text-xs">EIP-712 typed-data signer for buyer flows (AWS Lambda + KMS)</div>
            </div>
          </li>
        </ul>
      </div>
      <div>
        <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-4">SDKs <span class="text-gray-600 normal-case tracking-normal">— shipping with the submission</span></h2>
        <ul class="space-y-3 text-sm">
          <li class="flex items-start gap-3">
            <span class="text-red-400 font-bold text-xs mt-0.5 shrink-0">npm</span>
            <div>
              <div class="text-white font-bold">@reckon402/types</div>
              <div class="text-gray-500 text-xs">Canonical x402 v2 wire-format types</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-red-400 font-bold text-xs mt-0.5 shrink-0">npm</span>
            <div>
              <div class="text-white font-bold">@reckon402/buyer-sdk</div>
              <div class="text-gray-500 text-xs">Buyer-side helpers: paymentId, EIP-3009 sign, encode</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-red-400 font-bold text-xs mt-0.5 shrink-0">npm</span>
            <div>
              <div class="text-white font-bold">@reckon402/middleware-hono</div>
              <div class="text-gray-500 text-xs"><code class="text-gray-400">withX402</code> middleware factory for Hono merchants</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-red-400 font-bold text-xs mt-0.5 shrink-0">npm</span>
            <div>
              <div class="text-white font-bold">@reckon402/facilitator-client</div>
              <div class="text-gray-500 text-xs">Reckon402 facilitator HTTP client</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-red-400 font-bold text-xs mt-0.5 shrink-0">npm</span>
            <div>
              <div class="text-white font-bold">@reckon402/erc-8004-client</div>
              <div class="text-gray-500 text-xs">ERC-8004 Identity + Reputation reads (multichain)</div>
            </div>
          </li>
          <li class="flex items-start gap-3">
            <span class="text-red-400 font-bold text-xs mt-0.5 shrink-0">npm</span>
            <div>
              <div class="text-white font-bold">@reckon402/kh-skill</div>
              <div class="text-gray-500 text-xs">KeeperHub skill bundle (workflow integration)</div>
            </div>
          </li>
        </ul>
      </div>
    </section>

    <!-- TECH STACK -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Tech stack</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3 text-sm">
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-green-400 font-bold text-base mb-1">x402 v2</div>
          <div class="text-gray-500 text-xs">HTTP payment protocol</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-amber-400 font-bold text-base mb-1">ERC-8004</div>
          <div class="text-gray-500 text-xs">On-chain agent identity and reputation</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-blue-400 font-bold text-base mb-1">ENS + CCIP-Read</div>
          <div class="text-gray-500 text-xs">Off-chain resolver, ENSIP-25, CAIP-2</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-orange-400 font-bold text-base mb-1">Cloudflare Workers</div>
          <div class="text-gray-500 text-xs">D1, Workers Assets, custom domains</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-blue-300 font-bold text-base mb-1">Base Sepolia</div>
          <div class="text-gray-500 text-xs">USDC, Splitter, Escrow, ERC-8004</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-purple-300 font-bold text-base mb-1">Ethereum Sepolia</div>
          <div class="text-gray-500 text-xs">ENS registry, Reckon402Resolver, subnames</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-green-300 font-bold text-base mb-1">Hono</div>
          <div class="text-gray-500 text-xs">withX402 middleware, facilitator routes</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-pink-300 font-bold text-base mb-1">AWS Lambda + KMS</div>
          <div class="text-gray-500 text-xs">EIP-712 typed-data signer</div>
        </div>
      </div>
    </section>

    <!-- STATS -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Test posture</h2>
      <div class="grid grid-cols-3 gap-4">
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 text-center">
          <div class="text-3xl font-bold text-green-400">362</div>
          <div class="text-xs text-gray-500 mt-1">Vitest tests passing</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 text-center">
          <div class="text-3xl font-bold text-amber-400">109</div>
          <div class="text-xs text-gray-500 mt-1">Forge tests passing</div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 text-center">
          <div class="text-3xl font-bold text-blue-400">15/15</div>
          <div class="text-xs text-gray-500 mt-1">healthz probes green</div>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="border-t border-gray-800 pt-6">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
        <span>Built for <span class="text-gray-500">ETHGlobal OpenAgents 2026</span></span>
        <a href="https://github.com/hamiha70/reckon402" target="_blank" rel="noopener" class="text-gray-500 hover:text-gray-400">github.com/hamiha70/reckon402</a>
      </div>
    </footer>

  </div>

  <script>
    (function() {
      var endpoints = [
        { id: 'dot-agent', url: 'https://agent.reckon402.com/healthz' },
        { id: 'dot-app', url: 'https://app.reckon402.com/healthz' },
        { id: 'dot-facilitator', url: 'https://facilitator.reckon402.com/healthz' },
        { id: 'dot-gateway', url: 'https://gateway.reckon402.com/healthz' },
        { id: 'dot-signing', url: 'https://signing.reckon402.com/healthz' }
      ];
      endpoints.forEach(function(ep) {
        fetch(ep.url, { signal: AbortSignal.timeout(3000) })
          .then(function(r) { if (!r.ok) throw new Error(); return r.text(); })
          .then(function(body) {
            if (body.indexOf('ok') !== -1) {
              var el = document.getElementById(ep.id);
              if (el) el.style.backgroundColor = '#4ade80';
            }
          })
          .catch(function() {});
      });
    })();
  <\/script>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
};
