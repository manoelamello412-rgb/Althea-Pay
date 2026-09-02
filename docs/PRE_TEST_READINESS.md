# ALTHEA PAY — pré-teste 90%

## Objetivo
Deixar a plataforma preparada para teste integrado antes de conectar credenciais de produção.

## Preparado
- Autenticação e proteção de rotas.
- Banco multi-tenant com RLS nas áreas públicas.
- API pública com API Keys, escopos, rate limit e idempotência.
- Ingestão de eventos de funil com deduplicação, retries e worker.
- Checkout com idempotência e projeção de venda.
- Orquestrador com rotas, health guard, fallback e sandbox.
- Adaptador de gateway sandbox com contrato comum.
- Webhooks com assinatura HMAC, deduplicação e observabilidade.
- Segredos de novos webhooks armazenados no Supabase Vault; o segredo bruto não fica mais em `webhook_integrations.secret`.
- Recuperação de checkout abandonado e scheduler ativo.
- Reconciliação/DLQ e fluxo de evidências de disputa.
- Realtime operacional.
- CI, typecheck, lint, testes e build configurados.
- OpenAPI/Postman iniciais.

## Ainda não é produção
- Credenciais de PSP/gateway reais.
- 3DS, liquidação real e arquivos de settlement.
- PCI/KYC/AML, contratos e políticas legais.
- Pentest e teste de carga externo.
- Ativação manual do Leaked Password Protection no Supabase.
- Definição das políticas RLS específicas de `private.api_request_logs` e `private.api_rate_limit_buckets`; estas tabelas não devem ter RLS ativado sem política de acesso definida.

## Critério para iniciar os testes
1. Testar login/recuperação.
2. Criar funil, produto e rota sandbox.
3. Criar checkout.
4. Executar aprovação, recusa e erro técnico.
5. Validar fallback.
6. Validar evento duplicado e webhook duplicado.
7. Validar venda + atribuição + automação.
8. Validar abandono/recuperação.
9. Validar reconciliação com dados de settlement de teste.
10. Validar disputa/evidência.

Nenhum teste deve usar PAN/CVC real.
