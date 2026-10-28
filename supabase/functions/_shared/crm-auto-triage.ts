export type AutoTriageIntent =
  | "existing_member_payment"
  | "experimental_ally"
  | "receipt_name"
  | "refund"

export type AutoTriageDecision =
  | { action: "human"; reason: "agent_available" }
  | { action: "reply"; intent: AutoTriageIntent; replyTitle: string }
  | { action: "funnel_menu"; replyTitle: string }
  | { action: "general_menu"; replyTitle: string }

export const AUTO_REPLY_TITLES = {
  existing_member_payment: "AUTO | Aliado | Já sou aliado",
  experimental_ally: "AUTO | Aliado | O que é",
  receipt_name: "AUTO | Aliado | Nome no comprovante",
  refund: "AUTO | Aliado | Reserva e reembolso",
  funnel_menu: "AUTO | Aliado | Menu",
  general_menu: "AUTO | Geral | Boas-vindas",
} as const

const MENU_INTENTS: Record<string, AutoTriageIntent> = {
  "1": "existing_member_payment",
  "2": "experimental_ally",
  "3": "receipt_name",
  "4": "refund",
}

const INTENT_TERMS: Record<AutoTriageIntent, string[]> = {
  existing_member_payment: [
    "ja faco parte",
    "ja sou aliado",
    "sou da alianca",
    "preciso pagar",
    "continuar pagando",
    "pagar mensalidade",
    "isento da mensalidade",
  ],
  experimental_ally: [
    "o que e aliado experimental",
    "que e aliado experimental",
    "como funciona o aliado experimental",
    "como funciona essa experiencia",
    "aliado experimental",
  ],
  receipt_name: [
    "nome no comprovante",
    "outro nome no comprovante",
    "comprovante aparece outro nome",
    "nome diferente no comprovante",
    "nome diferente no extrato",
    "nome da intermediadora",
    "nome do intermediador",
  ],
  refund: [
    "reserva e reembolso",
    "reserva e o reembolso",
    "reembolso",
    "pedir reembolso",
    "solicitar reembolso",
    "quero reembolso",
    "posso desistir",
    "prazo para desistir",
    "cancelar a compra",
    "devolucao do dinheiro",
  ],
}

export function normalizeTriageText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
}

export function menuIntent(value: string): AutoTriageIntent | null {
  const normalized = normalizeTriageText(value)
  const choice = /^(?:opcao\s*)?([1-4])$/.exec(normalized)?.[1]
  return choice ? MENU_INTENTS[choice] ?? null : null
}

export function detectAutoTriageIntent(
  value: string,
): AutoTriageIntent | null {
  const normalized = normalizeTriageText(value)
  if (!normalized) return null

  const matches = (
    Object.entries(INTENT_TERMS) as [AutoTriageIntent, string[]][]
  )
    .map(([intent, terms]) => ({
      intent,
      score: terms.reduce(
        (best, term) =>
          Math.max(best, normalized.includes(term) ? term.length : 0),
        0,
      ),
    }))
    .filter(result => result.score > 0)
    .sort((left, right) => right.score - left.score)

  if (matches.length === 0) return null
  if (matches.length > 1 && matches[0].score === matches[1].score) {
    return null
  }

  return matches[0].intent
}

export function decideAutoTriage(input: {
  humanAvailable: boolean
  belongsToTargetFunnel: boolean
  message: string
  awaitingFunnelMenu?: boolean
}): AutoTriageDecision {
  if (input.humanAvailable) {
    return { action: "human", reason: "agent_available" }
  }

  if (!input.belongsToTargetFunnel) {
    return {
      action: "general_menu",
      replyTitle: AUTO_REPLY_TITLES.general_menu,
    }
  }

  const intent = input.awaitingFunnelMenu
    ? menuIntent(input.message) ?? detectAutoTriageIntent(input.message)
    : detectAutoTriageIntent(input.message)

  if (!intent) {
    return {
      action: "funnel_menu",
      replyTitle: AUTO_REPLY_TITLES.funnel_menu,
    }
  }

  return {
    action: "reply",
    intent,
    replyTitle: AUTO_REPLY_TITLES[intent],
  }
}
