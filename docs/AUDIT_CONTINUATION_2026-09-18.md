# Althea Pay — continuação da auditoria, 18/09/2026

## Estado

Auditoria **em andamento**, sem autorização técnica para merge ou lançamento.
Retomada a partir de `35286d706708ff73cac6c74914dd7f2b136e8f64` na branch
`fix/supabase-github-audit-20260917`. As correções posteriores ao documento de
transferência foram preservadas. Nenhuma alteração foi feita em `main` nesta etapa.

## Falhas reproduzidas e corrigidas

1. A Edge Function já chamava `gateway_runtime_route_candidates`, mas o corpo da
   RPC delegava à função ausente `rank_gateway_candidates`. Uma chamada somente
   de leitura retornou PostgreSQL `42883`. Recuperada a lógica da migration real
   `20260911040252`, incorporada à RPC canônica e conferidas suas tabelas e a
   dependência `gateway_effective_cost_bps` no banco atual. Corrigidos também o
   alias de ordenação, a expressão decimal e o escopo de usuário da saúde.
2. A assinatura com cinco argumentos coexistia com a de seis cujo último
   argumento tinha valor padrão. A chamada com cinco falhava com `42725`.
   Removida exclusivamente a assinatura redundante, com `RESTRICT`, após consulta
   sem dependências no catálogo. A assinatura canônica aceita as duas formas.
3. O orquestrador agora valida o retorno antes de inserir uma transação: rejeita
   candidatos fora do conjunto solicitado, duplicados, circuito aberto e dados
   inválidos. Uma política ausente passa a ser tratada como objeto vazio.
4. `npm ci` convencional falhava porque a árvore de `picomatch` do lockfile não
   satisfazia as dependências. Lockfile regenerado com npm e instalação limpa
   concluída sem `--legacy-peer-deps`. Não foram escolhidas versões manualmente.

Migrations versionadas antes da aplicação e reconciliadas com as versões reais:

- `20260918034336_canonical_gateway_runtime_ranking.sql`
- `20260918034600_remove_ambiguous_gateway_ranking_overload.sql`

O banco foi verificado depois das aplicações: chamadas com cinco e seis argumentos
retornam zero candidatos para usuário inexistente e lista vazia; ambas deixam de
falhar. A RPC restante permite EXECUTE a `service_role`, não a `anon` nem
`authenticated`. Nenhuma transação de pagamento foi criada por estes testes.
O snapshot `types/supabase.ts` foi regenerado do projeto real.

## Evidência desta etapa

| Verificação | Resultado |
| --- | --- |
| Instalação limpa npm | Passou após correção do lockfile |
| Typecheck e lint | Passaram |
| Testes | 22 arquivos passaram; 85 testes passaram; 2 arquivos / 4 testes ignorados |
| Build Next.js | Passou; 57 páginas geradas |
| Sintaxe TS/TSX/JS/MJS | 177 arquivos analisados, zero erros sintáticos |
| Imports locais estáticos | 101 referências verificadas, zero destinos ausentes |
| Python | AST dos arquivos de `ai-engine` válido; não equivale a teste do motor |
| JSON / YAML / TOML | Parsing aprovado; 6 arquivos YAML |
| Preflight | Passou; 539 arquivos examinados |
| Referências literais ao banco | 90 nomes de RPC e 64 relações encontrados no catálogo real |
| Edge Functions | 40 locais, 40 remotas, 40 no config; nenhuma divergência de `verify_jwt` |

A varredura de nomes não comprova argumentos, projeções de colunas, autorização,
referências dinâmicas ou comportamento interno de todas as RPCs. A checagem de
imports não executa módulos remotos Deno. O preflight conta referências de testes;
zero órfãos reportados não comprova ausência de código operacional morto.

## Pendências para fechamento

- Auditar o caminho real de fallback do `gateway-orchestrator`: a classificação
  atual permite continuar após timeout/erro de transporte, e as chaves de
  idempotência variam por gateway. Um timeout não prova ausência de cobrança.
  Os testes de `lib/routing/SmartRouter.ts` não executam esta Edge Function.
- Verificar se `SmartRouter.ts`, referenciado apenas pelos testes na varredura,
  deve ser removido como implementação sem consumidor operacional.
- Concluir revisão semântica de todos os contratos e políticas. O Advisor ainda
  lista 36 funções SECURITY DEFINER executáveis por authenticated, 4 por anon,
  9 tabelas com RLS sem políticas e proteção contra senhas vazadas desativada.
  As quatro funções anon são os contratos públicos de checkout/chat; não foram
  bloqueadas indiscriminadamente. Os números são achados, não 50 vulnerabilidades
  confirmadas. [Referência do Advisor](https://supabase.com/docs/guides/database/database-linter).
- Reconciliar o histórico antigo de migrations; `db push` automático continua
  bloqueado. Estas duas migrations não resolvem a divergência histórica.
- Executar E2E com fixtures e provedores sandbox: gateway → conexão → funil → PIX
  → webhook/status → venda → CRM/chat → troca de gateway, além de isolamento
  entre organizações. Os testes SQL desta etapa usaram conjunto vazio.
- Validar a Edge Function modificada em runtime/deploy e concluir os checks do
  último commit. O código foi enviado à branch; não houve deploy da Edge Function
  nem merge nesta etapa. O reparo das RPCs foi aplicado diretamente e verificado.

## Compatibilidade e recuperação

As migrations antigas foram preservadas. As correções não alteram tabelas nem
dados financeiros. O contrato e colunas de retorno da RPC canônica permanecem.
Se uma regressão exigir recuperação, usar uma migration forward que restaure o
corpo revisado da função de seis argumentos, mantendo grants restritos. Não
reintroduzir o overload ambíguo nem a delegação à função inexistente.
