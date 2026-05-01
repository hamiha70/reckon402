export default {
  fetch() {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>Reckon402 — Trust-Based Pricing for AI Agents</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <style>body{font-family:'JetBrains Mono','Fira Mono','Courier New',monospace}</style>
</head>
<body class="bg-gray-950 text-gray-100 min-h-screen flex flex-col items-center justify-center px-4">
  <div class="max-w-2xl w-full space-y-8">

    <div class="text-center">
      <h1 class="text-4xl font-bold tracking-tight text-green-400 mb-2">Reckon402</h1>
      <p class="text-gray-400 text-lg">Trust-based pricing infrastructure for AI agent commerce.</p>
    </div>

    <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 space-y-4 font-mono text-sm">
      <div class="text-green-500">$ curl https://agent.reckon402.com/research</div>
      <div class="text-gray-400 pl-2">HTTP 402 — Payment Required</div>
      <div class="text-green-500 mt-2">$ curl -H "payment-signature: &lt;signed&gt;" \\<br/>&nbsp;&nbsp;&nbsp;&nbsp;https://agent.reckon402.com/research</div>
      <div class="text-gray-400 pl-2">HTTP 200 — settled on-chain in &lt;3s</div>
    </div>

    <div class="grid grid-cols-3 gap-4 text-center text-sm">
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div class="text-2xl font-bold text-green-400 mb-1">x402</div>
        <div class="text-gray-500">HTTP payment protocol</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div class="text-2xl font-bold text-amber-400 mb-1">ERC-8004</div>
        <div class="text-gray-500">On-chain reputation</div>
      </div>
      <div class="bg-gray-900 border border-gray-800 rounded-lg p-4">
        <div class="text-2xl font-bold text-blue-400 mb-1">ENS</div>
        <div class="text-gray-500">Agent identity</div>
      </div>
    </div>

    <div class="bg-gray-900 border border-gray-800 rounded-lg p-6 text-sm space-y-3">
      <h2 class="text-gray-400 uppercase tracking-wider text-xs mb-3">How it works</h2>
      <div class="flex items-start gap-3">
        <span class="text-green-400 font-bold w-6 shrink-0">1.</span>
        <span class="text-gray-300">SellingAgent onboards with one command — ENS subname, Splitter contract, ERC-8004 agentId deployed automatically.</span>
      </div>
      <div class="flex items-start gap-3">
        <span class="text-green-400 font-bold w-6 shrink-0">2.</span>
        <span class="text-gray-300">BuyingAgent pays per request via USDC transferWithAuthorization — no wallets, no popups, no friction.</span>
      </div>
      <div class="flex items-start gap-3">
        <span class="text-green-400 font-bold w-6 shrink-0">3.</span>
        <span class="text-gray-300">Each settled payment writes an ERC-8004 attestation on-chain — trust accumulates, price drops automatically.</span>
      </div>
    </div>

    <div class="flex flex-col sm:flex-row gap-4 justify-center">
      <a href="https://app.reckon402.com"
         class="bg-green-600 hover:bg-green-500 text-gray-950 font-bold py-3 px-6 rounded text-center transition-colors">
        Launch App →
      </a>
      <a href="https://github.com/hamiha70/reckon402"
         class="bg-gray-800 hover:bg-gray-700 text-gray-100 font-bold py-3 px-6 rounded text-center transition-colors">
        View on GitHub
      </a>
    </div>

    <div class="text-center text-xs text-gray-600">
      Built for ETHGlobal OpenAgents 2026 · Base Sepolia · Ethereum Sepolia
    </div>

  </div>
</body>
</html>`
    return new Response(html, {
      headers: { 'Content-Type': 'text/html;charset=UTF-8' },
    })
  }
}
