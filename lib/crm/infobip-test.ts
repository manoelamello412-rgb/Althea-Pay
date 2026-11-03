// Plain-language result for the Infobip "Testar" button, from GET /whatsapp/2/senders/{number}/templates.
export function infobipTestResult(status: number | null): { ok: boolean; message: string } {
  if (status === null) return { ok: false, message: 'Não foi possível falar com a Infobip. Confira a URL base (xxxxx.api.infobip.com).' }
  if (status >= 200 && status < 300) return { ok: true, message: 'Conectado: a chave funciona e o número está ativo na Infobip.' }
  if (status === 401 || status === 403) return { ok: false, message: 'Chave inválida ou sem permissão de WhatsApp. Gere uma nova API key na Infobip.' }
  if (status === 404 || status === 400) return { ok: false, message: 'Número remetente não encontrado nesta conta Infobip. Confira o número cadastrado.' }
  return { ok: false, message: `A Infobip respondeu com erro (${status}). Tente de novo em alguns minutos.` }
}
