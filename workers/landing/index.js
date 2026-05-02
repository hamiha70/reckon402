// ─── Shared chrome (logo + page shell) ─────────────────────────────────────
//
// Used by /ens and /keeperhub track pages so they read as siblings of the
// main / page. The main / page intentionally inlines its own scaffold so
// this refactor stays low-risk for H-9.

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="56" height="56" role="img" aria-label="Reckon402 logo">
  <title>Reckon402</title>
  <path d="M14 28 L26 40 L50 16" fill="none" stroke="#22D67B" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>
  <rect x="14" y="46" width="36" height="3.5" rx="1.5" fill="#22D67B"/>
  <rect x="14" y="52" width="26" height="3.5" rx="1.5" fill="#22D67B" opacity="0.65"/>
  <rect x="14" y="58" width="16" height="3.5" rx="1.5" fill="#22D67B" opacity="0.35"/>
</svg>`;

function renderShell({ title, description, eyebrow, heading, subheading, accentColor, body }) {
  // accentColor is a Tailwind color name without the shade suffix, e.g. 'blue'.
  // Used for the eyebrow tag and accent links.
  const safeTitle = `Reckon402 — ${title}`;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>${safeTitle}</title>
  <meta name="description" content="${description}"/>
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
    code.inline { background: #111827; border: 1px solid #1f2937; border-radius: 4px; padding: 1px 6px; font-size: 12px; color: #d1d5db; }
    a.evidence-link { color: #60a5fa; text-decoration: none; border-bottom: 1px dotted #1e3a8a; }
    a.evidence-link:hover { color: #93c5fd; border-bottom-color: #60a5fa; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen px-4 py-12">
  <div class="max-w-5xl mx-auto space-y-10">

    <!-- Top nav: back to landing -->
    <nav class="flex items-center justify-between text-xs">
      <a href="/" class="flex items-center gap-3 text-gray-400 hover:text-white transition-colors">
        <span>${LOGO_SVG.replace('width="56" height="56"', 'width="28" height="28"')}</span>
        <span><span class="text-white font-bold">Reckon</span><span class="text-green-400 font-bold">402</span> <span class="text-gray-500">/ ${title.toLowerCase()}</span></span>
      </a>
      <a href="/" class="text-gray-500 hover:text-gray-300">← back to overview</a>
    </nav>

    <!-- HERO -->
    <header class="space-y-4 pb-6 border-b border-gray-800">
      <div class="text-${accentColor}-400 text-xs uppercase tracking-widest font-bold">${eyebrow}</div>
      <h1 class="text-3xl sm:text-4xl font-bold text-white leading-tight tracking-tight">${heading}</h1>
      <p class="text-gray-300 text-base leading-relaxed max-w-3xl">${subheading}</p>
    </header>

    ${body}

    <!-- FOOTER -->
    <footer class="border-t border-gray-800 pt-6">
      <div class="flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
        <span>Built for <span class="text-gray-500">ETHGlobal OpenAgents 2026</span></span>
        <a href="https://github.com/hamiha70/reckon402" target="_blank" rel="noopener" class="text-gray-500 hover:text-gray-400">github.com/hamiha70/reckon402</a>
      </div>
    </footer>

  </div>
</body>
</html>`;
}

// ─── Shared evidence — single source for HTML pages and JSON endpoints ─────

const ENS_EVIDENCE = {
  track: 'ENS',
  tagline: 'Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back. The trust signal drives history-aware behavior — for this hackathon, a per-agent on-chain Escrow that holds funds against future claims and releases as on-chain reputation grows.',
  evidence: [
    {
      item: 'Reckon402Resolver deployed on Ethereum Sepolia',
      address: '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
      tx: '0xb658d064556f217be83f322f9800f19dcc07bff61a6dde22f85d7fa28edc945f',
      block: 10749903,
    },
    {
      item: 'ENS reckon402-test.eth resolver set to Reckon402Resolver via setResolver',
      tx: '0xc852b44767e2318d24ac024f83e2be9342f2e25bdfe566157cdcf076519bf975',
      block: 10750233,
    },
    {
      item: 'x402.* text records served via CCIP-Read: x402.facilitator, x402.splitter, x402.amount, x402.erc8004.agent_id',
      gateway: 'https://gateway.reckon402.com',
      ensName: 'seller11.reckon402-test.eth',
    },
    {
      item: 'Gateway-enforced ACL: SellingAgent-owned keys (x402.amount, x402.pricing, x402.endpoint) vs Reckon402-owned keys (x402.splitter, x402.facilitator, x402.erc8004.registry, x402.erc8004.agent_id)',
      spec: 'specs/08b-l4c-onboarding.md',
    },
    {
      item: 'CCIP-Read flow: Resolver emits OffchainLookup, client fetches gateway.reckon402.com, D1-backed record returned with signature, on-chain verification completes',
      resolver: '0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a',
      gateway: 'https://gateway.reckon402.com',
    },
  ],
};

const KH_EVIDENCE = {
  track: 'KeeperHub',
  tagline: 'Every x402 settlement writes ERC-8004 reputation. Every ENS lookup reads it back. The trust signal drives history-aware behavior — for this hackathon, a per-agent on-chain Escrow that holds funds against future claims and releases as on-chain reputation grows.',
  evidence: [
    {
      item: 'Live KH workflow: deployed publicly on app.keeperhub.com (manual-trigger node, owned by hamiha70 KH account)',
      url: 'https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9',
      workflowId: '5b5bx18671fappzbchqt9',
      visibility: 'public',
      published: '2026-05-02',
    },
    {
      item: 'KH workflow recipe: importable workflow definition for autonomous x402 buyer flow (same definition that produced the live workflow above)',
      artifact: 'recipes/kh-workflow.json',
    },
    {
      item: 'Signing wrapper: AWS Lambda + KMS endpoint for EIP-712 typed-data (workaround for KH sandbox limitation)',
      url: 'https://signing.reckon402.com',
      healthz: 'https://signing.reckon402.com/healthz',
    },
    {
      item: '@reckon402/kh-skill npm package',
      package: '@reckon402/kh-skill',
      source: 'packages/kh-skill/',
    },
    {
      item: 'Builder feedback: 4 concrete gaps filed in FEEDBACK.md',
      artifact: 'FEEDBACK.md',
      gaps: [
        'In-sandbox EIP-712 typed-data signing is a hard blocker for x402 buyer flows',
        'ERC-8004 endpoint is not shipped (404 during verification pass)',
        'Payment receipt loop is fire-and-forget (no wait_for_receipt primitive)',
        'Documentation gap on the buyer side (examples are mostly merchant-side)',
      ],
    },
    {
      item: 'End-to-end: KH workflow wallet authenticates via Turnkey TEE; signing wrapper signs x402 PaymentAuthorizations via KMS buyer-signer',
      khWallet: '0xA1bd1F82D1c13CE11f8480cF705a82b00382c1e4',
      signerEOA: '0x46bbb05aca9ea24118b8a57c8d3f317503384305',
    },
  ],
};

function wantsJson(request, url) {
  if (url.searchParams.get('format') === 'json') return true;
  const accept = request.headers.get('accept') || '';
  return accept.includes('application/json') && !accept.includes('text/html');
}

function jsonResponse(payload) {
  return new Response(JSON.stringify(payload, null, 2), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

function htmlResponse(html) {
  return new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html;charset=UTF-8' },
  });
}

function renderEnsPage() {
  const body = `
    <!-- WHY ENS IS LOAD-BEARING -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Why ENS is load-bearing here</h2>
      <p class="text-gray-300 text-sm leading-relaxed mb-3">
        ENS is not cosmetic in Reckon402. <code class="inline">seller11.reckon402-test.eth</code> is the
        SellingAgent's identity AND the on-chain anchor that wires every settlement into the
        per-agent Escrow + tier-strategy contracts. The buyer-facing price
        (<code class="inline">x402.amount</code>) stays constant; what walks with on-chain reputation
        is how much of the Escrow buffer the seller can <em>withdraw</em>. Each paid call grows the
        SellingAgent's ERC-8004 attestation count; the next call reads it back through CCIP-Read
        and the configured <code class="inline">ITierStrategy</code> recomputes the released BPS in
        the agent's Escrow.
      </p>
      <ul class="text-gray-300 text-sm leading-relaxed space-y-2 list-none">
        <li class="flex gap-2"><span class="text-blue-400 shrink-0">›</span><span>ENSIP-10 wildcard subnames under <code class="inline">reckon402-test.eth</code>, one per SellingAgent</span></li>
        <li class="flex gap-2"><span class="text-blue-400 shrink-0">›</span><span>EIP-3668 CCIP-Read with <code class="inline">msg.sender</code> in <code class="inline">callData</code> (Pattern A) — vanilla viem and wagmi clients work without custom code</span></li>
        <li class="flex gap-2"><span class="text-blue-400 shrink-0">›</span><span>ENSIP-25 text records (<code class="inline">x402.erc8004.registry</code>, <code class="inline">x402.erc8004.agent_id</code>, <code class="inline">x402.escrow</code>) create the canonical ENS↔ERC-8004↔Escrow binding at SellingAgent onboarding</span></li>
        <li class="flex gap-2"><span class="text-blue-400 shrink-0">›</span><span>Gateway-enforced ACL splits ownership: SellingAgent-owned keys cannot be silently overwritten by the platform</span></li>
        <li class="flex gap-2"><span class="text-blue-400 shrink-0">›</span><span>The same ENS name resolves the agent's <em>tier</em> as reputation grows — not the price the buyer pays</span></li>
      </ul>
    </section>

    <!-- ENSIP-25 TEXT RECORDS TABLE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">ENSIP-25 text records (per SellingAgent)</h2>
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table class="w-full text-xs">
          <thead class="bg-gray-950 text-gray-500">
            <tr>
              <th class="text-left p-3 font-normal">Key</th>
              <th class="text-left p-3 font-normal">Owner</th>
              <th class="text-left p-3 font-normal">Purpose</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800 text-gray-300">
            <tr><td class="p-3 font-mono text-blue-300">x402.amount</td><td class="p-3 text-amber-300">SellingAgent</td><td class="p-3">Routed per-call price (signed off-chain record, served via gateway)</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.pricing</td><td class="p-3 text-amber-300">SellingAgent</td><td class="p-3">Optional pricing-policy hint (tier-aware behaviour)</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.endpoint</td><td class="p-3 text-amber-300">SellingAgent</td><td class="p-3">HTTPS endpoint that serves paid requests</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.attestation</td><td class="p-3 text-amber-300">SellingAgent</td><td class="p-3">Opt-in toggle for facilitator-signed ERC-8004 attestations</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.splitter</td><td class="p-3 text-green-300">Reckon402</td><td class="p-3">Per-agent Splitter (CREATE2 address on Base Sepolia)</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.escrow</td><td class="p-3 text-green-300">Reckon402</td><td class="p-3">Per-agent Escrow (NFT-bound to agentId)</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.facilitator</td><td class="p-3 text-green-300">Reckon402</td><td class="p-3">Facilitator URL the agent settles through</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.erc8004.registry</td><td class="p-3 text-green-300">Reckon402</td><td class="p-3">ReputationRegistry address (Base Sepolia 0x8004B663…)</td></tr>
            <tr><td class="p-3 font-mono text-blue-300">x402.erc8004.agent_id</td><td class="p-3 text-green-300">Reckon402</td><td class="p-3">SellingAgent's IdentityRegistry tokenId</td></tr>
          </tbody>
        </table>
      </div>
      <p class="text-xs text-gray-600 mt-3 leading-relaxed">
        Owner column drives the gateway ACL. SellingAgent-owned keys require the subname owner's EOA signature; Reckon402-owned keys require the onboarding EOA's signature. The ACL is enforced at the gateway's signed-write endpoint before any D1 write.
      </p>
    </section>

    <!-- TRY IT LIVE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Try it live</h2>
      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 text-sm space-y-2">
          <div class="text-blue-400 text-xs uppercase tracking-wider font-bold">Resolve x402.amount via CCIP-Read</div>
          <pre class="bg-gray-950 border border-gray-800 rounded p-3 text-xs text-gray-300 overflow-x-auto leading-relaxed">cast resolve-name --rpc-url $ETH_SEPOLIA_RPC \\
  seller11.reckon402-test.eth

cast call --rpc-url $ETH_SEPOLIA_RPC \\
  $RESOLVER 'text(bytes32,string)(string)' \\
  $(cast namehash seller11.reckon402-test.eth) \\
  'x402.amount'</pre>
          <p class="text-xs text-gray-500 leading-relaxed">vanilla <code class="inline">cast</code> follows the OffchainLookup automatically — no Reckon402-specific tooling.</p>
        </div>

        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5 text-sm space-y-2">
          <div class="text-blue-400 text-xs uppercase tracking-wider font-bold">Direct gateway probe</div>
          <pre class="bg-gray-950 border border-gray-800 rounded p-3 text-xs text-gray-300 overflow-x-auto leading-relaxed">curl -s https://gateway.reckon402.com/records/\\
  seller11.reckon402-test.eth | jq

curl -s https://gateway.reckon402.com/healthz</pre>
          <p class="text-xs text-gray-500 leading-relaxed">Gateway returns the flat record map and a healthz dot — used internally by the agent dashboard.</p>
        </div>
      </div>
    </section>

    <!-- ON-CHAIN EVIDENCE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">On-chain evidence</h2>
      <div class="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800">
        <div class="p-4 text-sm">
          <div class="text-gray-400 text-xs uppercase tracking-wider mb-1">Reckon402Resolver — Ethereum Sepolia</div>
          <div class="font-mono text-blue-300 break-all"><a class="evidence-link" href="https://sepolia.etherscan.io/address/0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a" target="_blank" rel="noopener">0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a</a></div>
          <div class="text-xs text-gray-500 mt-1">deploy tx <a class="evidence-link" href="https://sepolia.etherscan.io/tx/0xb658d064556f217be83f322f9800f19dcc07bff61a6dde22f85d7fa28edc945f" target="_blank" rel="noopener">0xb658d064…</a> · block 10,749,903</div>
        </div>
        <div class="p-4 text-sm">
          <div class="text-gray-400 text-xs uppercase tracking-wider mb-1">ENS setResolver tx</div>
          <div class="text-xs text-gray-300">reckon402-test.eth → Reckon402Resolver</div>
          <div class="text-xs text-gray-500 mt-1">tx <a class="evidence-link" href="https://sepolia.etherscan.io/tx/0xc852b44767e2318d24ac024f83e2be9342f2e25bdfe566157cdcf076519bf975" target="_blank" rel="noopener">0xc852b447…</a> · block 10,750,233</div>
        </div>
        <div class="p-4 text-sm">
          <div class="text-gray-400 text-xs uppercase tracking-wider mb-1">Demo SellingAgent</div>
          <div class="font-mono text-amber-300">seller11.reckon402-test.eth</div>
          <div class="text-xs text-gray-500 mt-1">5 ERC-8004 attestations · tier T2 · releasedBps 1500 · NFT-bound Escrow <a class="evidence-link" href="https://sepolia.basescan.org/address/0x863d2105B57Cb98129B68b934FF5708DC9432aAA" target="_blank" rel="noopener">0x863d2105…</a></div>
        </div>
        <div class="p-4 text-sm">
          <div class="text-gray-400 text-xs uppercase tracking-wider mb-1">Live gateway — try the seller11 record map</div>
          <div class="text-xs"><a class="evidence-link" href="https://gateway.reckon402.com/records/seller11.reckon402-test.eth" target="_blank" rel="noopener">https://gateway.reckon402.com/records/seller11.reckon402-test.eth</a></div>
          <div class="text-xs text-gray-500 mt-1">flat JSON of every <code class="inline">x402.*</code> ENS text record served via CCIP-Read · gateway healthz at <a class="evidence-link" href="https://gateway.reckon402.com/healthz" target="_blank" rel="noopener">/healthz</a></div>
        </div>
      </div>
      <p class="text-xs text-gray-600 mt-3 leading-relaxed">
        Raw evidence as JSON: <a class="evidence-link" href="/ens?format=json">/ens?format=json</a> · also available via <code class="inline">Accept: application/json</code>.
      </p>
    </section>
  `;

  return renderShell({
    title: 'ENS',
    description: 'ENS as the SellingAgent identity AND the on-chain anchor for the per-agent Escrow + tier-strategy. The trust signal walks the Escrow withdrawal BPS, not the buyer-facing price.',
    eyebrow: 'ETHGlobal OpenAgents 2026 · ENS prize tracks',
    heading: 'ENS as identity AND escrow-tier anchor.',
    subheading: 'Best ENS Integration for AI Agents · Most Creative Use of ENS. The same ENS name resolves the agent\'s tier as on-chain reputation accumulates — the gateway reads ERC-8004 live and passes the count through a pluggable ITierStrategy that controls the per-agent Escrow\'s withdrawable BPS. The buyer-facing price stays constant.',
    accentColor: 'blue',
    body,
  });
}

function renderKhPage() {
  const body = `
    <!-- WHAT WE SHIP -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">What Reckon402 ships for KeeperHub</h2>
      <p class="text-gray-300 text-sm leading-relaxed mb-3">
        Two prize tracks, one stack. <strong class="text-white">Best Integration</strong> — a workflow recipe + skill bundle that
        drives the full Reckon402 closed loop from a KH workflow.
        <strong class="text-white">Builder Feedback Bounty</strong> — four concrete gaps filed against KH's public surface, each
        with the workaround we built and the first-party primitive that would close it.
      </p>

      <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div class="card-hover bg-gray-900 border-2 border-pink-700/60 rounded-lg p-5 space-y-2 md:col-span-2">
          <div class="flex items-center gap-2">
            <span class="text-pink-300 text-xs uppercase tracking-wider font-bold">Live KH workflow</span>
            <span class="text-[10px] bg-pink-900/40 text-pink-200 px-1.5 py-0.5 rounded uppercase tracking-wider">deployed · public</span>
          </div>
          <div class="text-sm text-gray-200 leading-relaxed">
            Published on KeeperHub as a public workflow with a manual-trigger node, ready for judges to inspect:
          </div>
          <a href="https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9" target="_blank" rel="noopener"
             class="block bg-gray-950 border border-gray-800 hover:border-pink-700 rounded p-3 text-pink-300 font-mono text-xs break-all transition-colors">
            https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9
          </a>
          <div class="text-xs text-gray-500 leading-relaxed">
            One-trigger workflow: hits <code class="inline">agent.reckon402.com/research</code>, the buyer-sdk path negotiates the x402 paywall, signing wrapper produces the EIP-712 PaymentAuthorization, facilitator settles + writes the ERC-8004 attestation. Owned by the <code class="inline">hamiha70</code> KH account.
          </div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-pink-400 text-xs uppercase tracking-wider font-bold">@reckon402/kh-skill</div>
          <div class="text-sm text-gray-300 leading-relaxed">
            KH workflow node reference implementation that wraps <code class="inline">@reckon402/buyer-sdk</code>.
            Demonstrates Focus Area 2 (Payments): KH workflows paying x402-priced APIs autonomously.
          </div>
          <div class="text-xs text-gray-500"><code class="inline">packages/kh-skill/</code> · workspace stub at <code class="inline">@0.1.0</code></div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-pink-400 text-xs uppercase tracking-wider font-bold">recipes/kh-workflow.json</div>
          <div class="text-sm text-gray-300 leading-relaxed">
            Importable workflow JSON — same definition that produced the live workflow above. Drop it into another KH account to provision an identical workflow without re-engineering.
          </div>
          <div class="text-xs text-gray-500">three sequential paid calls → attestations accumulate live</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-pink-400 text-xs uppercase tracking-wider font-bold">signing.reckon402.com</div>
          <div class="text-sm text-gray-300 leading-relaxed">
            AWS Lambda + KMS endpoint that signs EIP-712 typed-data destined for x402 HTTP bodies — the workaround for KH's in-sandbox typed-data limitation.
          </div>
          <div class="text-xs text-gray-500">healthz: <a class="evidence-link" href="https://signing.reckon402.com/healthz" target="_blank" rel="noopener">https://signing.reckon402.com/healthz</a></div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-pink-400 text-xs uppercase tracking-wider font-bold">FEEDBACK.md</div>
          <div class="text-sm text-gray-300 leading-relaxed">
            Four concrete builder gaps from shipping KH + x402 + ERC-8004 end-to-end. Each gap names the workaround and the first-party primitive that would replace it.
          </div>
          <div class="text-xs text-gray-500">repo root <code class="inline">FEEDBACK.md</code></div>
        </div>
      </div>
    </section>

    <!-- BUILDER FEEDBACK INLINE -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Builder feedback — the four gaps</h2>
      <div class="space-y-3">
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div class="flex items-start gap-3">
            <span class="text-pink-400 font-bold text-sm shrink-0">1.</span>
            <div class="space-y-2">
              <div class="text-white font-bold text-sm">In-sandbox EIP-712 typed-data signing is a hard blocker for x402 buyer flows</div>
              <div class="text-gray-400 text-xs leading-relaxed">KH's documented Turnkey + Direct Execution surface signs on-chain transactions but not arbitrary EIP-712 typed-data destined for HTTP bodies. We deployed AWS Lambda + KMS as a workaround at <code class="inline">signing.reckon402.com/sign</code>. A first-party KH-built Turnkey policy that produces signed typed-data without leaving the sandbox would turn x402 + KH into a one-line integration.</div>
            </div>
          </div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div class="flex items-start gap-3">
            <span class="text-pink-400 font-bold text-sm shrink-0">2.</span>
            <div class="space-y-2">
              <div class="text-white font-bold text-sm">ERC-8004 endpoint isn't shipped (per the roadmap)</div>
              <div class="text-gray-400 text-xs leading-relaxed"><code class="inline">app.keeperhub.com/.well-known/erc8004.json</code>, <code class="inline">/agent.json</code>, and <code class="inline">/agent</code> all returned 404 during the 2026-04-24 verification pass. We read the canonical Base Sepolia ReputationRegistry directly via <code class="inline">@reckon402/erc-8004-client</code>. A first-party KH wrapper around ERC-8004 reads would let workflows do reputation-aware execution without external chain reads.</div>
            </div>
          </div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div class="flex items-start gap-3">
            <span class="text-pink-400 font-bold text-sm shrink-0">3.</span>
            <div class="space-y-2">
              <div class="text-white font-bold text-sm">Payment receipt loop is fire-and-forget today</div>
              <div class="text-gray-400 text-xs leading-relaxed">PR #822 added payer tracking + protocol/chain columns, but a built-in <code class="inline">wait_for_receipt(paymentId)</code> step that polls a configured facilitator's <code class="inline">/receipt</code> endpoint until terminal state would close the loop without custom polling. Reckon402's facilitator already exposes <code class="inline">GET /x402/receipt/:paymentId</code>; a built-in KH primitive that wraps this pattern generalises to any x402 facilitator.</div>
            </div>
          </div>
        </div>
        <div class="bg-gray-900 border border-gray-800 rounded-lg p-5">
          <div class="flex items-start gap-3">
            <span class="text-pink-400 font-bold text-sm shrink-0">4.</span>
            <div class="space-y-2">
              <div class="text-white font-bold text-sm">Documentation gap on the buyer side</div>
              <div class="text-gray-400 text-xs leading-relaxed">Existing examples are mostly merchant-side (PRs #818, #821, #822, #835, #837, #840). An end-to-end "KH workflow as autonomous x402 buyer" worked example would have saved us several hours. We submit <code class="inline">recipes/kh-workflow.json</code> + <code class="inline">@reckon402/kh-skill</code> as a contribution toward this gap.</div>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- INTEGRATION ARCH -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Integration architecture</h2>
      <div class="arch-box">
<span class="blue">KH workflow</span> <span class="dim">— autonomous x402 buyer</span>

  <span class="hl">recipes/kh-workflow.json</span>
       <span class="dim">│</span>
       <span class="dim">▼</span>  three sequential paid calls
  <span class="hl">@reckon402/kh-skill</span>  <span class="dim">(workflow node)</span>
       <span class="dim">│</span>
       <span class="dim">▼</span>  GET agent.reckon402.com  →  402
  <span class="hl">@reckon402/buyer-sdk</span>
       <span class="dim">│</span>
       <span class="dim">▼</span>  prepares EIP-712 PaymentAuthorization
  <span class="hl">signing.reckon402.com/sign</span>
       <span class="dim">│ AWS Lambda + KMS buyer-signer</span>
       <span class="dim">▼</span>  signed X-Payment header
  agent.reckon402.com  →  facilitator  →  Splitter  →  Escrow
       <span class="dim">│</span>
       <span class="dim">▼</span>  facilitator-signed ERC-8004 attestation
  <span class="amber">on Base Sepolia ReputationRegistry</span>

KH wallet <span class="hl">0xA1bd1F82…c1e4</span> <span class="dim">(Turnkey TEE)</span>  authenticates the workflow
KMS signer <span class="hl">0x46bbb05a…4305</span>                   signs the typed-data
</div>
    </section>

    <!-- EVIDENCE FOOTER -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Evidence at a glance</h2>
      <div class="bg-gray-900 border border-gray-800 rounded-lg divide-y divide-gray-800 text-sm">
        <div class="p-4 flex justify-between items-center">
          <div><span class="text-gray-400">Live workflow on KH</span> <code class="inline ml-2 text-pink-300">5b5bx18671fappzbchqt9</code></div>
          <a class="evidence-link text-xs" href="https://app.keeperhub.com/workflows/5b5bx18671fappzbchqt9" target="_blank" rel="noopener">app.keeperhub.com →</a>
        </div>
        <div class="p-4 flex justify-between items-center">
          <div><span class="text-gray-400">Workflow recipe</span> <code class="inline ml-2">recipes/kh-workflow.json</code></div>
          <a class="evidence-link text-xs" href="https://github.com/hamiha70/reckon402/blob/main/recipes/kh-workflow.json" target="_blank" rel="noopener">view on GitHub →</a>
        </div>
        <div class="p-4 flex justify-between items-center">
          <div><span class="text-gray-400">Skill package</span> <code class="inline ml-2">@reckon402/kh-skill</code></div>
          <a class="evidence-link text-xs" href="https://github.com/hamiha70/reckon402/tree/main/packages/kh-skill" target="_blank" rel="noopener">packages/kh-skill →</a>
        </div>
        <div class="p-4 flex justify-between items-center">
          <div><span class="text-gray-400">Signing wrapper</span> <code class="inline ml-2">signing.reckon402.com</code></div>
          <a class="evidence-link text-xs" href="https://signing.reckon402.com/healthz" target="_blank" rel="noopener">healthz →</a>
        </div>
        <div class="p-4 flex justify-between items-center">
          <div><span class="text-gray-400">Builder feedback</span> <code class="inline ml-2">FEEDBACK.md</code></div>
          <a class="evidence-link text-xs" href="https://github.com/hamiha70/reckon402/blob/main/FEEDBACK.md" target="_blank" rel="noopener">view on GitHub →</a>
        </div>
      </div>
      <p class="text-xs text-gray-600 mt-3 leading-relaxed">
        Raw evidence as JSON: <a class="evidence-link" href="/keeperhub?format=json">/keeperhub?format=json</a> · also available via <code class="inline">Accept: application/json</code>.
      </p>
    </section>
  `;

  return renderShell({
    title: 'KeeperHub',
    description: 'Autonomous x402-paying KeeperHub workflow + four concrete builder feedback gaps from shipping KH + x402 + ERC-8004 end-to-end.',
    eyebrow: 'ETHGlobal OpenAgents 2026 · KeeperHub prize tracks',
    heading: 'KH workflows paying x402 APIs autonomously.',
    subheading: 'Best Integration · Builder Feedback Bounty. A workflow recipe + skill bundle drives the closed Reckon402 loop from KH; four concrete gaps name the first-party primitives that would replace our workarounds.',
    accentColor: 'pink',
    body,
  });
}

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
      return wantsJson(request, url) ? jsonResponse(ENS_EVIDENCE) : htmlResponse(renderEnsPage());
    }

    if (url.pathname === '/keeperhub') {
      return wantsJson(request, url) ? jsonResponse(KH_EVIDENCE) : htmlResponse(renderKhPage());
    }

    const logoSvg = LOGO_SVG;

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
