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
    .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; }
    .npm-badge { display: inline-flex; align-items: center; gap: 6px; background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 3px 10px; font-size: 11px; color: #9ca3af; text-decoration: none; }
    .npm-badge:hover { border-color: #374151; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen px-4 py-12">
  <div class="max-w-4xl mx-auto space-y-12">

    <!-- HERO -->
    <header class="space-y-4 pb-6 border-b border-gray-800">
      <div class="flex items-center gap-5">
        <div class="shrink-0">${logoSvg}</div>
        <div>
          <h1 class="text-3xl font-bold tracking-tight">
            <span class="text-white">Reckon</span><span class="text-green-400">402</span>
          </h1>
        </div>
      </div>
      <p class="text-2xl font-bold text-white leading-tight">Agent commerce with memory.</p>
      <p class="text-gray-400 text-sm leading-relaxed max-w-3xl">Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back. The trust signal drives history-aware behavior — for this hackathon, a per-agent on-chain Escrow that holds funds against future claims and releases as on-chain reputation grows.</p>
      <div class="flex flex-col sm:flex-row gap-3 pt-2">
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

    <!-- PROBLEM -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-4">The two open problems</h2>
      <p class="text-gray-300 text-sm leading-relaxed max-w-3xl">Agent commerce isn’t ready for prime time. The individual standards exist — x402 negotiates payment in HTTP, ENS gives agents names, ERC-8004 tracks identity and reputation on-chain, USDC settles. None of them close the loop, so two sets of open problems pile up. <strong class="text-white">The first is trust:</strong> a buying agent paying a seller it has never met has no verifiable on-chain history to read, no escrow to hold against bad delivery, no path to revoke a payment, no mechanism to price-adjust by counterparty, no primitive for investable agents or optimistic service handling. <strong class="text-white">The second is privacy and economics:</strong> every payment is a public datapoint, and per-call gas overhead breaks sub-cent pricing. Both sets need new primitives. Reckon402 builds the first.</p>
    </section>

    <!-- SOLUTION -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-4">What we built</h2>
      <div class="space-y-4 text-gray-300 text-sm leading-relaxed max-w-3xl">
        <p>Reckon402 closes that first loop. Every confirmed x402 payment writes an ERC-8004 reputation attestation, signed by the facilitator, on-chain. Every subsequent ENS resolution reads that history back through CCIP-Read and returns a <strong class="text-white">trust signal</strong> — a verifiable count of past settlements between the same parties. Downstream code can bind that signal to any history-aware behavior: tier-adjusted price, risk-weighted routing, optimistic-vs-strict service handling, investable-agent revenue claims.</p>
        <p>For this hackathon we pick the single most consistently underbuilt behavior: <strong class="text-white">claims and revocation after settlement</strong>. A portion of every payment flows into a per-agent on-chain Escrow. The Escrow’s release schedule is parameterized by the same trust signal: low reputation → small fraction released, large buffer held against future claims; high reputation → most of the payment flows through immediately. Funds release as on-chain reputation grows, NFT-bound to the agent’s IdentityRegistry token so the buffer transfers with ownership.</p>
      </div>
    </section>

    <!-- LIVE STATUS -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Live services</h2>
      <div class="flex flex-wrap gap-6 text-xs text-gray-400">
        <span class="flex items-center gap-2">
          <span id="dot-facilitator" class="dot bg-gray-600"></span>
          facilitator.reckon402.com
        </span>
        <span class="flex items-center gap-2">
          <span id="dot-gateway" class="dot bg-gray-600"></span>
          gateway.reckon402.com
        </span>
        <span class="flex items-center gap-2">
          <span id="dot-signing" class="dot bg-gray-600"></span>
          signing.reckon402.com
        </span>
      </div>
    </section>

    <!-- ARCHITECTURE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Architecture</h2>
      <div class="arch-box">
<span class="hl">BuyingAgent</span> ──── PAYMENT-SIGNATURE ──► <span class="hl">Agent Worker</span> <span class="dim">(Hono + withX402)</span>
                                              │
                                    POST /x402/settle
                                              │
                                    <span class="blue">Facilitator Worker</span> ──► <span class="amber">Base Sepolia</span>
                                              │              ├─ USDC transferWithAuthorization
                                              │              ├─ Splitter.distribute <span class="dim">(87% seller / 3% facilitator / 10% Escrow)</span>
                                              │              └─ ReputationRegistry.giveFeedback
                                              │
                                    <span class="blue">ENS Gateway</span> <span class="dim">(CCIP-Read)</span> ◄── next request reads tier
                                              │
                                    <span class="hl">Reckon402Resolver</span> <span class="dim">(ETH Sepolia)</span>
                                    <span class="dim">▲ subnames: seller{N}.reckon402-test.eth</span></div>
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

    <!-- HACKATHON SCOPE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-4">Hackathon scope</h2>
      <div class="space-y-4 text-gray-300 text-sm leading-relaxed max-w-3xl">
        <p><strong class="text-white">Built in this hackathon.</strong> Facilitator-signed ERC-8004 attestations on every settlement; CCIP-Read ENS gateway returning the trust count; per-agent SplitterFactory + Escrow with a pluggable, parameterized tier curve; NFT-bound withdraw; fork-tested against live ERC-8004 contracts on Base Sepolia.</p>
        <p><strong class="text-white">To be built after.</strong> Buyer-side proof-of-non-delivery (zkTLS via Reclaim Protocol on the buyer SDK) that triggers a negative attestation and unlocks Escrow withdrawal back to the buyer. Other history-aware adaptations — pure tier pricing, risk-weighted routing, optimistic-vs-strict handling, investable-agent revenue claims — drop in directly; they’re consumer-side, not protocol-side. The orthogonal problem space (privacy + batching + sub-cent economics) belongs to a different solution vector and is out of scope for Reckon402.</p>
      </div>
    </section>

    <!-- TECH STACK -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Tech stack</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
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
          <div class="text-green-300 font-bold text-base mb-1">Hono</div>
          <div class="text-gray-500 text-xs">withX402 middleware, facilitator routes</div>
        </div>
      </div>
    </section>

    <!-- FOOTER -->
    <footer class="border-t border-gray-800 pt-6 space-y-4">
      <div class="flex flex-wrap gap-2">
        <a href="https://www.npmjs.com/package/@reckon402/types" target="_blank" rel="noopener" class="npm-badge">
          <span class="text-red-400 font-bold">npm</span> @reckon402/types
        </a>
        <a href="https://www.npmjs.com/package/@reckon402/buyer-sdk" target="_blank" rel="noopener" class="npm-badge">
          <span class="text-red-400 font-bold">npm</span> @reckon402/buyer-sdk
        </a>
        <a href="https://www.npmjs.com/package/@reckon402/middleware-hono" target="_blank" rel="noopener" class="npm-badge">
          <span class="text-red-400 font-bold">npm</span> @reckon402/middleware-hono
        </a>
        <a href="https://www.npmjs.com/package/@reckon402/facilitator-client" target="_blank" rel="noopener" class="npm-badge">
          <span class="text-red-400 font-bold">npm</span> @reckon402/facilitator-client
        </a>
        <a href="https://www.npmjs.com/package/@reckon402/erc-8004-client" target="_blank" rel="noopener" class="npm-badge">
          <span class="text-red-400 font-bold">npm</span> @reckon402/erc-8004-client
        </a>
        <a href="https://www.npmjs.com/package/@reckon402/kh-skill" target="_blank" rel="noopener" class="npm-badge">
          <span class="text-red-400 font-bold">npm</span> @reckon402/kh-skill
        </a>
      </div>
      <div class="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
        <span>Built for <span class="text-gray-500">ETHGlobal OpenAgents 2026</span></span>
        <a href="https://github.com/hamiha70/reckon402" target="_blank" rel="noopener" class="text-gray-500 hover:text-gray-400">github.com/hamiha70/reckon402</a>
      </div>
    </footer>

  </div>

  <script>
    (function() {
      var endpoints = [
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
