// Pushcut notification body ({title, text}) for an outbound webhook event. Pure, so vitest can import it.
type Json = Record<string, unknown>;

const str = (value: unknown) => (typeof value === "string" ? value.trim() : value == null ? "" : String(value));
const money = (amount: unknown, currency: unknown) => {
  const n = Number(amount);
  if (!Number.isFinite(n)) return "";
  try {
    return new Intl.NumberFormat("pt-BR", { style: "currency", currency: str(currency) || "BRL" }).format(n);
  } catch {
    return `${str(currency)} ${n.toFixed(2)}`;
  }
};

const TITLES: Record<string, string> = {
  "transaction.approved": "Venda aprovada",
  "transaction.pending": "Pagamento pendente",
  "transaction.failed": "Pagamento falhou",
  "transaction.refunded": "Estorno",
  "transaction.chargeback": "Chargeback",
  "message.received": "Nova mensagem",
  "webhook.test": "Teste da Althea Pay",
};

export function pushcutMessage(eventType: string, data: Json): { title: string; text: string } {
  const customer = (data.customer && typeof data.customer === "object" ? data.customer : {}) as Json;
  const who = str(customer.name) || str(customer.email) || str(customer.phone);
  const funnel = str(data.funnel_name);
  const title = TITLES[eventType] ?? eventType;
  if (eventType === "message.received") {
    return { title: `${title}${funnel ? ` · ${funnel}` : ""}`, text: [who, str(data.body)].filter(Boolean).join(": ").slice(0, 300) || "Mensagem recebida" };
  }
  if (eventType.startsWith("transaction.")) {
    return {
      title: `${title} ${money(data.amount, data.currency)}`.trim(),
      text: [who, str(data.product_name) || funnel].filter(Boolean).join(" · ") || "Althea Pay",
    };
  }
  return { title, text: str(data.message) || "Althea Pay" };
}
