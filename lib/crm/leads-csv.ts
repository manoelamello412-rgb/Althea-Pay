// CSV for Excel in pt-BR: ";" separator and a BOM so accents open right. Cells that start with = + - @ get a
// leading apostrophe, so a participant's name can't run as a formula (CSV injection).
export type LeadRow = { phone: string; name: string | null; known: boolean }

const cell = (value: string) => {
  const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value
  return /[";\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

// "55 11999990000": stays text in Excel (a bare 13-digit number turns into 5,51E+12).
const phoneText = (phone: string) => `${phone.slice(0, 2)} ${phone.slice(2)}`

export function leadsCsv(rows: LeadRow[], group: string): string {
  const lines = [['Nome', 'Telefone', 'Grupo', 'Já era cliente'], ...rows.map(r => [r.name ?? '', phoneText(r.phone), group, r.known ? 'sim' : 'não'])]
  return '﻿' + lines.map(line => line.map(cell).join(';')).join('\r\n')
}

// Same number written twice (or with a different mask) counts once.
export function uniqueByPhone<T extends { phone: string }>(rows: T[]): T[] {
  const seen = new Set<string>()
  return rows.filter(r => { const key = r.phone.replace(/\D/g, ''); if (!key || seen.has(key)) return false; seen.add(key); return true })
}
