# @reckon402/logger

Structured log utility for Reckon402 Cloudflare Workers — emits `[LEVEL] [component] event key=value` lines to `console.*` for `wrangler tail`.

```sh
npm install @reckon402/logger
```

```ts
import { makeLogger } from '@reckon402/logger'
const log = makeLogger('settle')
log.info('transfer_confirmed', { paymentId, tx })
log.error('distribute_failed', { paymentId, detail: err.message })
```

Part of the [Reckon402](https://github.com/hamiha70/reckon402) x402 v2 payment infrastructure.
