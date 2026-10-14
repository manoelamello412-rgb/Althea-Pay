import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { RECEIPT_MAX_BYTES, sniffReceiptType } from '../lib/chat/receipt'

const bytes = (...values: number[]) => new Uint8Array([...values, ...new Array(16).fill(0)])
const ascii = (text: string) => [...text].map(char => char.charCodeAt(0))

describe('transfer receipt file sniffing', () => {
  it('accepts receipts by magic bytes', () => {
    expect(sniffReceiptType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe('image/jpeg')
    expect(sniffReceiptType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a))).toBe('image/png')
    expect(sniffReceiptType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WEBP')))).toBe('image/webp')
    expect(sniffReceiptType(bytes(...ascii('%PDF-1.7')))).toBe('application/pdf')
  })

  it('rejects anything else, whatever the declared type', () => {
    expect(sniffReceiptType(bytes(...ascii('<svg xmlns')))).toBeNull()
    expect(sniffReceiptType(bytes(...ascii('<html>')))).toBeNull()
    expect(sniffReceiptType(bytes(...ascii('RIFF'), 0, 0, 0, 0, ...ascii('WAVE')))).toBeNull()
    expect(sniffReceiptType(new Uint8Array())).toBeNull()
  })

  it('stays under the Vercel request body limit', () => {
    expect(RECEIPT_MAX_BYTES).toBeLessThan(4.5 * 1024 * 1024)
  })
})

describe('transfer receipt contract', () => {
  const migration = readFileSync('supabase/migrations/20261013140000_chat_transfer_receipt_v1.sql', 'utf8')
  const route = readFileSync('app/api/funnel/chat/attachment/route.ts', 'utf8')

  it('stores receipts in a private bucket readable only with chats + values capability', () => {
    expect(migration).toContain("'chat-attachments', 'chat-attachments', false")
    expect(migration).toContain("'can_view_chats'")
    expect(migration).toContain("'can_view_values'")
  })

  it('keeps the public RPCs behind the server and pins the path to the conversation', () => {
    expect(migration).toContain('to service_role')
    expect(migration).toMatch(/revoke all on function public\.crm_public_attachment_message[^;]*from public, anon, authenticated/)
    expect(migration).toContain("'invalid_attachment_path'")
  })

  it('never exposes the storage path to the buyer', () => {
    const publicConversation = migration.slice(migration.indexOf('FUNCTION public.crm_public_conversation'))
    expect(publicConversation).not.toContain("->>'path'")
  })

  it('validates by content, rate limits, and cleans up orphaned uploads', () => {
    expect(route).toContain('sniffReceiptType(bytes)')
    expect(route).toContain("'chat-attachment'")
    expect(route).toContain(".remove([path])")
  })
})
