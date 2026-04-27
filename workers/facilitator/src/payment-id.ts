// computePaymentId is the single source of truth in @reckon402/buyer-sdk.
// Both the buyer and the facilitator import from there — no cross-impl
// drift is possible (shared function, not duplicated code + byte-equality test).
export { computePaymentId } from '@reckon402/buyer-sdk'
