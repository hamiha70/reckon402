export type GatewayErrorCode =
  | 'MALFORMED_CALL_DATA'
  | 'UNKNOWN_NAME'
  | 'NOT_IMPLEMENTED'
  | 'INTERNAL_ERROR'

export class GatewayError extends Error {
  constructor(
    public readonly code: GatewayErrorCode,
    message: string,
  ) {
    super(message)
    this.name = 'GatewayError'
  }
}

export function errorToStatus(code: GatewayErrorCode): number {
  switch (code) {
    case 'MALFORMED_CALL_DATA': return 400
    case 'UNKNOWN_NAME':        return 400
    case 'NOT_IMPLEMENTED':     return 501
    case 'INTERNAL_ERROR':      return 500
  }
}
