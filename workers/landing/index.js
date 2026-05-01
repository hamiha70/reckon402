export default {
  fetch() {
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
  <title>Reckon402 — Trust-Based Pricing for AI Agent Commerce</title>
  <meta name="description" content="Trust-based pricing infrastructure for AI agent commerce — x402 · ERC-8004 · ENS"/>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>
    body { font-family: 'JetBrains Mono', 'Fira Mono', 'Courier New', monospace; }
    .terminal-cursor::after { content: '▌'; animation: blink 1.1s step-end infinite; color: #4ade80; }
    @keyframes blink { 0%,100% { opacity: 1; } 50% { opacity: 0; } }
    .card-hover { transition: border-color 0.15s, box-shadow 0.15s; }
    .card-hover:hover { border-color: #4ade80 !important; box-shadow: 0 0 0 1px #4ade8022; }
    .badge { display: inline-flex; align-items: center; gap: 6px; background: #111827; border: 1px solid #1f2937; border-radius: 6px; padding: 2px 10px; font-size: 11px; color: #9ca3af; }
    .arch-box { border: 1px solid #1f2937; background: #030712; border-radius: 8px; padding: 1.5rem; overflow-x: auto; white-space: pre; font-size: 12px; line-height: 1.7; color: #6b7280; }
    .arch-box .hl { color: #4ade80; }
    .arch-box .dim { color: #374151; }
    .arch-box .blue { color: #60a5fa; }
    .arch-box .amber { color: #fbbf24; }
    details > summary { cursor: pointer; list-style: none; }
    details > summary::-webkit-details-marker { display: none; }
    .hash { font-size: 11px; letter-spacing: 0.02em; }
  </style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen px-4 py-12">
  <div class="max-w-4xl mx-auto space-y-10">

    <!-- ── HERO ─────────────────────────────────────────────────────────── -->
    <header class="flex items-center gap-5 pb-2 border-b border-gray-800">
      <div class="shrink-0">${logoSvg}</div>
      <div>
        <h1 class="text-3xl font-bold tracking-tight">
          <span class="text-white">Reckon</span><span class="text-green-400">402</span>
        </h1>
        <p class="text-gray-400 text-sm mt-1 leading-relaxed">
          Trust-based pricing infrastructure for AI agent commerce &mdash;
          <span class="text-green-400">x402</span> &middot;
          <span class="text-amber-400">ERC-8004</span> &middot;
          <span class="text-blue-400">ENS</span>
        </p>
      </div>
      <div class="ml-auto hidden sm:flex items-center gap-3 text-xs text-gray-500">
        <span class="badge"><span class="text-green-400">●</span> Base Sepolia</span>
        <span class="badge"><span class="text-blue-400">●</span> ETH Sepolia</span>
      </div>
    </header>

    <!-- ── TERMINAL DEMO ──────────────────────────────────────────────── -->
    <section class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
      <div class="flex items-center gap-2 px-4 py-2.5 bg-gray-800/60 border-b border-gray-800">
        <span class="w-3 h-3 rounded-full bg-red-500/70"></span>
        <span class="w-3 h-3 rounded-full bg-yellow-500/70"></span>
        <span class="w-3 h-3 rounded-full bg-green-500/70"></span>
        <span class="ml-3 text-xs text-gray-500">reckon402 — demo</span>
      </div>
      <div class="p-5 text-sm leading-relaxed space-y-2">
        <div><span class="text-green-400">$</span> <span class="text-gray-200">curl https://agent.reckon402.com/research</span></div>
        <div class="pl-4 text-gray-500">HTTP/2 <span class="text-yellow-400 font-bold">402</span> Payment Required</div>
        <div class="pl-4 text-gray-600">x402-version: 2</div>
        <div class="pl-4 text-gray-600">payment-required: eyJzY2hlbWUiOiJleGFjdCIsIm5ldHdvcmsiOiJiYXNlLXNlcHBv&hellip;</div>
        <div class="mt-3"><span class="text-green-400">$</span> <span class="text-gray-200">curl -H <span class="text-amber-300">"payment-signature: &lt;signed&gt;"</span> \\</span></div>
        <div class="pl-9 text-gray-200">https://agent.reckon402.com/research</div>
        <div class="pl-4 text-gray-500">HTTP/2 <span class="text-green-400 font-bold">200</span> OK&nbsp;
          <span class="text-green-400">✓ settled on-chain in 3s</span>
          <span class="text-gray-600"> · agentId=1 · tier=<span class="text-amber-400">gold</span> · price=<span class="text-green-400">0.0722 USDC</span></span>
        </div>
        <div class="pl-4 text-gray-600">x-reckon-tx: 0xa1b2c3d4&hellip;</div>
        <div class="text-green-400 terminal-cursor text-xs mt-1"></div>
      </div>
    </section>

    <!-- ── ARCHITECTURE DIAGRAM ───────────────────────────────────────── -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Architecture</h2>
      <div class="arch-box">
<span class="hl">BuyingAgent</span> ──── PAYMENT-SIGNATURE ──► <span class="hl">Agent Worker</span> <span class="dim">(Hono + withX402)</span>
                                              │
                                    POST /x402/settle
                                              │
                                    <span class="blue">Facilitator Worker</span> ──► <span class="amber">Base Sepolia</span>
                                              │              ├─ USDC transferWithAuthorization
                                              │              ├─ Splitter.distribute <span class="dim">(97/2/1%)</span>
                                              │              └─ ReputationRegistry.giveFeedback
                                              │
                                    <span class="blue">ENS Gateway</span> <span class="dim">(CCIP-Read)</span> ◄── next request reads tier
                                              │
                                    <span class="hl">Reckon402Resolver</span> <span class="dim">(ETH Sepolia)</span>
                                    <span class="dim">▲ subnames: seller{N}.reckon402-test.eth</span></div>
    </section>

    <!-- ── TECH STACK ─────────────────────────────────────────────────── -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Tech Stack</h2>
      <div class="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-green-400 font-bold text-base mb-1">x402 v2</div>
          <div class="text-gray-500 text-xs">HTTP payment protocol · 402 native</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-amber-400 font-bold text-base mb-1">ERC-8004</div>
          <div class="text-gray-500 text-xs">On-chain agent identity &amp; reputation</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-blue-400 font-bold text-base mb-1">ENS · ENSIP-25</div>
          <div class="text-gray-500 text-xs">CCIP-Read · off-chain resolver · CAIP-2</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-orange-400 font-bold text-base mb-1">Cloudflare Workers</div>
          <div class="text-gray-500 text-xs">Edge-native · zero cold starts</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-blue-300 font-bold text-base mb-1">Base Sepolia</div>
          <div class="text-gray-500 text-xs">USDC · Splitter · ERC-8004 contracts</div>
        </div>
        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4">
          <div class="text-green-300 font-bold text-base mb-1">Hono</div>
          <div class="text-gray-500 text-xs">Middleware: withX402 · withReputation</div>
        </div>
      </div>
    </section>

    <!-- ── KEY FEATURES ───────────────────────────────────────────────── -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Key Features</h2>
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-green-400 text-xl">⚡</div>
          <div class="text-gray-100 font-semibold text-sm">SellingAgent onboarding in ~60s</div>
          <div class="text-gray-500 text-xs leading-relaxed">
            One command, five steps: ENS subname registered, Splitter contract deployed,
            ERC-8004 agentId minted, CCIP-Read resolver wired, live.
          </div>
        </div>

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-amber-400 text-xl">🔗</div>
          <div class="text-gray-100 font-semibold text-sm">Trust closes the loop</div>
          <div class="text-gray-500 text-xs leading-relaxed">
            Every settled payment writes an ERC-8004 attestation on-chain.
            Next request reads the updated tier via ENS CCIP-Read — price drops automatically.
          </div>
        </div>

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-5 space-y-2">
          <div class="text-blue-400 text-xl">🔐</div>
          <div class="text-gray-100 font-semibold text-sm">Seller sovereignty</div>
          <div class="text-gray-500 text-xs leading-relaxed">
            ENS subname and ERC-8004 agentId are owned by the seller's wallet.
            Platform can't revoke your identity or lock your funds.
          </div>
        </div>

      </div>
    </section>

    <!-- ── SMART CONTRACTS ────────────────────────────────────────────── -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">Smart Contracts</h2>
      <div class="bg-gray-900 border border-gray-800 rounded-lg overflow-hidden">
        <table class="w-full text-xs">
          <thead>
            <tr class="border-b border-gray-800 text-gray-500">
              <th class="text-left px-4 py-2.5 font-medium">Contract</th>
              <th class="text-left px-4 py-2.5 font-medium hidden sm:table-cell">Network</th>
              <th class="text-left px-4 py-2.5 font-medium">Address</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-gray-800/50">
            <tr class="hover:bg-gray-800/30 transition-colors">
              <td class="px-4 py-3 text-green-400">Reckon402Resolver</td>
              <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">ETH Sepolia</td>
              <td class="px-4 py-3">
                <a href="https://sepolia.etherscan.io/address/0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a"
                   target="_blank" rel="noopener"
                   class="hash text-blue-400 hover:text-blue-300 transition-colors">
                  0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a
                </a>
              </td>
            </tr>
            <tr class="hover:bg-gray-800/30 transition-colors">
              <td class="px-4 py-3 text-amber-400">SplitterFactory</td>
              <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">Base Sepolia</td>
              <td class="px-4 py-3">
                <a href="https://sepolia.basescan.org/address/0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7"
                   target="_blank" rel="noopener"
                   class="hash text-blue-400 hover:text-blue-300 transition-colors">
                  0x3bbb50a50eb03f2d578d17f70ebc687b98e21fd7
                </a>
              </td>
            </tr>
            <tr class="hover:bg-gray-800/30 transition-colors">
              <td class="px-4 py-3 text-amber-400">IdentityRegistry <span class="text-gray-600">(ERC-8004)</span></td>
              <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">Base Sepolia</td>
              <td class="px-4 py-3">
                <a href="https://sepolia.basescan.org/address/0x8004A818BFB912233c491871b3d84c89A494BD9e"
                   target="_blank" rel="noopener"
                   class="hash text-blue-400 hover:text-blue-300 transition-colors">
                  0x8004A818BFB912233c491871b3d84c89A494BD9e
                </a>
              </td>
            </tr>
            <tr class="hover:bg-gray-800/30 transition-colors">
              <td class="px-4 py-3 text-amber-400">ReputationRegistry <span class="text-gray-600">(ERC-8004)</span></td>
              <td class="px-4 py-3 text-gray-500 hidden sm:table-cell">Base Sepolia</td>
              <td class="px-4 py-3">
                <a href="https://sepolia.basescan.org/address/0x8004B663056A597Dffe9eCcC1965A193B7388713"
                   target="_blank" rel="noopener"
                   class="hash text-blue-400 hover:text-blue-300 transition-colors">
                  0x8004B663056A597Dffe9eCcC1965A193B7388713
                </a>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </section>

    <!-- ── NPM PACKAGES ───────────────────────────────────────────────── -->
    <section>
      <h2 class="text-xs uppercase tracking-widest text-gray-500 mb-3">npm Packages</h2>
      <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-red-400 text-xs font-bold">npm</span>
            <span class="text-gray-200 text-sm font-semibold">@reckon402/buyer-sdk</span>
          </div>
          <div class="text-gray-500 text-xs">BuyingAgent wallet + automatic x402 payment negotiation</div>
          <div class="bg-gray-950 rounded px-3 py-1.5 text-xs text-green-400">
            npm install @reckon402/buyer-sdk
          </div>
        </div>

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-red-400 text-xs font-bold">npm</span>
            <span class="text-gray-200 text-sm font-semibold">@reckon402/middleware-hono</span>
          </div>
          <div class="text-gray-500 text-xs">Hono middleware: withX402 · withReputation · tier pricing</div>
          <div class="bg-gray-950 rounded px-3 py-1.5 text-xs text-green-400">
            npm install @reckon402/middleware-hono
          </div>
        </div>

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-red-400 text-xs font-bold">npm</span>
            <span class="text-gray-200 text-sm font-semibold">@reckon402/types</span>
          </div>
          <div class="text-gray-500 text-xs">Shared TypeScript types for the full Reckon402 stack</div>
          <div class="bg-gray-950 rounded px-3 py-1.5 text-xs text-green-400">
            npm install @reckon402/types
          </div>
        </div>

        <div class="card-hover bg-gray-900 border border-gray-800 rounded-lg p-4 space-y-2">
          <div class="flex items-center gap-2">
            <span class="text-red-400 text-xs font-bold">npm</span>
            <span class="text-gray-200 text-sm font-semibold">@reckon402/facilitator-client</span>
          </div>
          <div class="text-gray-500 text-xs">Client for the Reckon402 Facilitator Worker (settlement + callbacks)</div>
          <div class="bg-gray-950 rounded px-3 py-1.5 text-xs text-green-400">
            npm install @reckon402/facilitator-client
          </div>
        </div>

      </div>
    </section>

    <!-- ── CTA BUTTONS ────────────────────────────────────────────────── -->
    <section class="flex flex-col sm:flex-row gap-4">
      <a href="https://app.reckon402.com"
         class="flex-1 sm:flex-none bg-green-500 hover:bg-green-400 text-gray-950 font-bold py-3 px-8 rounded-lg text-center text-sm transition-colors">
        Launch App →
      </a>
      <a href="https://github.com/hamiha70/reckon402"
         target="_blank" rel="noopener"
         class="flex-1 sm:flex-none bg-gray-800 hover:bg-gray-700 text-gray-100 font-bold py-3 px-8 rounded-lg text-center text-sm transition-colors border border-gray-700">
        GitHub →
      </a>
      <a href="https://www.npmjs.com/org/reckon402"
         target="_blank" rel="noopener"
         class="flex-1 sm:flex-none bg-gray-800 hover:bg-gray-700 text-red-400 font-bold py-3 px-8 rounded-lg text-center text-sm transition-colors border border-gray-700">
        npm →
      </a>
    </section>

    <!-- ── FOOTER ─────────────────────────────────────────────────────── -->
    <footer class="border-t border-gray-800 pt-6 flex flex-col sm:flex-row items-center justify-between gap-2 text-xs text-gray-600">
      <span>Built for <span class="text-gray-500">ETHGlobal OpenAgents 2026</span></span>
      <span class="flex gap-4">
        <span>Base Sepolia</span>
        <span class="text-gray-700">·</span>
        <span>Ethereum Sepolia</span>
        <span class="text-gray-700">·</span>
        <span>reckon402.com</span>
      </span>
    </footer>

  </div>
</body>
</html>`;

    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    });
  },
};
