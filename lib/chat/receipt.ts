// Vercel caps function request bodies at 4.5 MB; keep the file (plus multipart overhead) under it.
export const RECEIPT_MAX_BYTES = 4 * 1024 * 1024
export const RECEIPT_ACCEPT = 'image/jpeg,image/png,image/webp,application/pdf'

const EXTENSIONS = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' } as const
export type ReceiptMimeType = keyof typeof EXTENSIONS

const startsWith = (bytes: Uint8Array, signature: number[], offset = 0) =>
  signature.every((value, index) => bytes[offset + index] === value)

// The declared Content-Type is attacker-controlled; trust only the file's magic bytes.
export function sniffReceiptType(bytes: Uint8Array): ReceiptMimeType | null {
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return 'image/jpeg'
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return 'image/png'
  if (startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) && startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)) return 'image/webp'
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return 'application/pdf'
  return null
}

export function receiptExtension(type: ReceiptMimeType) {
  return EXTENSIONS[type]
}
