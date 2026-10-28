import { describe, expect, it } from "vitest"
import {
  AUTO_REPLY_TITLES,
  decideAutoTriage,
  detectAutoTriageIntent,
  menuIntent,
  normalizeTriageText,
} from "../supabase/functions/_shared/crm-auto-triage"

describe("CRM automatic triage routing", () => {
  it("normalizes case, punctuation and Portuguese accents", () => {
    expect(
      normalizeTriageText("  Já FAÇO parte da Aliança?! 💚 "),
    ).toBe("ja faco parte da alianca")
  })

  it.each([
    [
      "Já faço parte da Aliança. Preciso pagar por essa experiência?",
      "existing_member_payment",
    ],
    [
      "O que é aliado experimental?",
      "experimental_ally",
    ],
    [
      "Por que no comprovante aparece outro nome?",
      "receipt_name",
    ],
    [
      "Como funciona a reserva e o reembolso?",
      "refund",
    ],
  ] as const)(
    "detects an approved intent in: %s",
    (message, intent) => {
      expect(detectAutoTriageIntent(message)).toBe(intent)
    },
  )

  it("does not invent an answer for a vague payment question", () => {
    expect(
      detectAutoTriageIntent("Quero falar sobre meu pagamento"),
    ).toBeNull()
  })

  it.each([
    ["1", "existing_member_payment"],
    ["opção 2", "experimental_ally"],
    ["3", "receipt_name"],
    ["4", "refund"],
  ] as const)("maps menu choice %s", (choice, intent) => {
    expect(menuIntent(choice)).toBe(intent)
  })

  it("leaves the conversation to an available human", () => {
    expect(
      decideAutoTriage({
        humanAvailable: true,
        belongsToTargetFunnel: true,
        message: "O que é?",
      }),
    ).toEqual({
      action: "human",
      reason: "agent_available",
    })
  })

  it("uses the approved answer for a recognized funnel question", () => {
    expect(
      decideAutoTriage({
        humanAvailable: false,
        belongsToTargetFunnel: true,
        message: "Por que aparece outro nome no comprovante?",
      }),
    ).toEqual({
      action: "reply",
      intent: "receipt_name",
      replyTitle: AUTO_REPLY_TITLES.receipt_name,
    })
  })

  it("shows the funnel menu when the question is not understood", () => {
    expect(
      decideAutoTriage({
        humanAvailable: false,
        belongsToTargetFunnel: true,
        message: "Tenho uma dúvida",
      }),
    ).toEqual({
      action: "funnel_menu",
      replyTitle: AUTO_REPLY_TITLES.funnel_menu,
    })
  })

  it("accepts a numeric answer after showing the funnel menu", () => {
    expect(
      decideAutoTriage({
        humanAvailable: false,
        belongsToTargetFunnel: true,
        awaitingFunnelMenu: true,
        message: "opção 4",
      }),
    ).toEqual({
      action: "reply",
      intent: "refund",
      replyTitle: AUTO_REPLY_TITLES.refund,
    })
  })

  it("welcomes contacts outside the target funnel", () => {
    expect(
      decideAutoTriage({
        humanAvailable: false,
        belongsToTargetFunnel: false,
        message: "Oi",
      }),
    ).toEqual({
      action: "general_menu",
      replyTitle: AUTO_REPLY_TITLES.general_menu,
    })
  })
})
