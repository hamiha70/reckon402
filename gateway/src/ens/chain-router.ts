// chain-router.ts — NOT NEEDED. No-op module; explanation only.
//
// The CCIP-Read gateway resolves records via resolveRecord(ensName, key, env)
// in gateway/src/resolution/dispatch.ts. The dispatch function queries D1
// keyed by ENS name + record key only — it never inspects the resolver
// contract address ("sender" in EIP-3668 terms) or derives a chain ID from
// the lookup request.
//
// Both the Sepolia resolver (0x479660B8760b32045FF4b9A64f9Ba2EeF8521f3a) and
// the mainnet resolver (<ETH_MAINNET_RESOLVER_ADDRESS after deploy>) share the
// same gateway URL:
//   https://gateway.reckon402.com/lookup/{sender}/{data}
//
// When the EIP-3668 client POSTs to /lookup, `sender` is the resolver address
// and is forwarded to signCcipResponse only to bind it into the ECDSA digest
// (preventing response replay across different resolver instances). It is not
// used for D1 routing.
//
// Consequence: the same gateway instance serves both Sepolia and mainnet
// CCIP-Read lookups without modification. No chain-routing helper is required.
//
// If a future requirement needs per-chain record divergence (e.g., mainnet
// has different x402.facilitator than Sepolia), the correct approach is to
// either: (a) use different ENS names per chain, or (b) add a `chain` column
// to the D1 records table and pass the chain ID as a query parameter on the
// gateway URL ({data}?chain=1 vs {data}?chain=11155111). That change would
// live in resolution/dispatch.ts and records.ts, not here.
