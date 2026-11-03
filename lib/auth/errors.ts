// Supabase Auth error messages in Portuguese.
export function authErrorPt(message: string): string {
  const text = message.toLowerCase()
  if (text.includes('invalid login credentials')) return 'E-mail ou senha incorretos. Confira os dados e tente novamente.'
  if (text.includes('email not confirmed')) return 'Seu e-mail ainda não foi confirmado. Confira sua caixa de entrada ou solicite um novo e-mail de confirmação.'
  if (text.includes('rate limit') || text.includes('too many requests')) return 'Muitas tentativas foram feitas. Aguarde alguns minutos antes de tentar novamente.'
  if (text.includes('should be different')) return 'A nova senha precisa ser diferente da atual.'
  if (text.includes('weak') || text.includes('at least') || text.includes('characters')) return 'Senha fraca: use pelo menos 8 caracteres, misturando letras e números.'
  if (text.includes('invalid totp') || text.includes('invalid code') || (text.includes('mfa') && text.includes('invalid'))) return 'Código inválido ou expirado. Confira o app autenticador e tente de novo.'
  if (text.includes('reauthentication') || text.includes('aal2')) return 'Confirme o código de 2 etapas antes de continuar.'
  if (text.includes('session') && (text.includes('missing') || text.includes('expired'))) return 'Sessão expirada. Entre novamente.'
  if (text.includes('password')) return 'A senha informada não é válida.'
  return message
}
