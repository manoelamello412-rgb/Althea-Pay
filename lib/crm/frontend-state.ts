/** Independent request lanes; a newer request or cleanup invalidates old results. */
export function createRequestGuard() {
  const versions = new Map<string, number>()
  let lifetime = 0
  return {
    begin(lane: string) {
      const version = (versions.get(lane) ?? 0) + 1
      const started = lifetime
      versions.set(lane, version)
      return () => lifetime === started && versions.get(lane) === version
    },
    invalidate(...lanes: string[]) {
      if (!lanes.length) { lifetime++; versions.clear(); return }
      for (const lane of lanes) versions.set(lane, (versions.get(lane) ?? 0) + 1)
    },
  }
}

export function mergeRows<T extends { id: string }>(existing: T[], incoming: T[]): T[] {
  return [...new Map([...existing, ...incoming].map(row => [row.id, row])).values()]
}

// Email identifies a buyer, not a conversation or a financial transaction.
export function eventBelongsToConversation(
  event: { transaction_id: string | null },
  conversation: { transaction_id: string | null } | null,
): boolean {
  return Boolean(conversation?.transaction_id && event.transaction_id === conversation.transaction_id)
}
