# Estabilidade do frontend — limites e contratos para Claude

Escopo desta etapa: recuperação de acesso, callbacks de erro do Next, estado/realtime/paginação do CRM e preservação de metadados de produtos. Nenhuma migration, policy, RLS, Edge Function ou lógica financeira foi alterada.

## BACKEND NECESSÁRIO

### 1. Associação inequívoca entre oportunidade e conversa — contrato entregue

- **Contrato confirmado:** `crm_recovery_opportunities(p_days integer default 7)` retorna `conversation_id: string | null` e `context_status: 'resolved' | 'unlinked' | 'ambiguous'`. O GET `/api/crm/recovery/opportunities` repassa esses campos.
- **Consumo frontend:** somente `resolved` com identificador válido permite abrir a conversa indicada. `unlinked`, `ambiguous`, campos ausentes/inválidos ou oportunidade não encontrada não abrem conversa automaticamente.
- **Links:** a central inclui o identificador canônico e o evento. O CRM revalida o evento pelo GET existente (`days=30`, limite já suportado) antes de selecionar a conversa. Links antigos contendo apenas `recovery_event` seguem essa mesma validação. O parâmetro `conversation` não sobrepõe a decisão canônica quando há um evento.
- **Fallback:** removido. Não há busca alternativa por transação ou e-mail para resolver uma conversa de recuperação. Uma oportunidade fora da janela ou da lista atual exige seleção manual.
- **Permissões e efeitos:** a leitura da conversa continua autenticada, limitada por `user_id` e pelas permissões existentes. Abrir um evento não cria conversa, envia mensagem ou aciona recuperação. A ação explícita de recuperação permanece separada e inalterada.
- **Preservado:** o isolamento dos eventos financeiros do painel lateral por transação continua vigente; trata-se de filtragem dos eventos da conversa já selecionada, não de resolução da conversa.
- **Backend adicional:** nenhum contrato novo é necessário para esta integração. Validar o comportamento com dados reais na homologação.

### 2. Garantia de concorrência para metadados de produtos

- **Problema:** o contrato atual de `update_product` substitui `metadata` integralmente. O frontend agora preserva o objeto carregado com a versão original. A garantia contra uma integração concorrente depende de todos os escritores respeitarem o versionamento.
- **Contrato esperado:** manter o controle de concorrência já existente (`p_version`) em todos os caminhos que alteram produto/metadados. Confirmar isso antes de prometer preservação perante escritores externos que ignorem versões. Não se solicita alterar o contrato nesta etapa.
- **Request existente:** `update_product({ p_product_id: string, p_version: number, p_metadata: Record<string, unknown>, ...camposEditáveis })`.
- **Response:** produto atualizado com versão incrementada em sucesso; erro de conflito do contrato existente se a versão não corresponder. Nenhuma atualização parcial no conflito.
- **Tipos:** metadados JSON, incluindo objetos aninhados, arrays, booleanos e valores nulos; versão inteira.
- **Permissões:** manter autorização e escopo organizacional já aplicados pela RPC e pelo banco. O frontend não amplia permissões.
- **Comportamento esperado:** preservar exatamente os metadados ao alterar outros campos; impedir sobrescrita de versão concorrente. Em conflito, a interface conserva a edição e mostra o erro; não força retry com versão nova e payload antigo.

### Configuração operacional a validar

A URL pública de `/reset-password` deve estar autorizada nos redirects do Supabase Auth, e o envio de e-mail deve estar configurado. Não houve alteração remota de Auth/SMTP. O frontend preserva `next` como destino local validado durante o pedido de recuperação e o retorno ao login.

### Fora desta etapa

Continuam pendentes os contratos já identificados na auditoria para aprovação de IA, pagamentos, capacidades do checkout, troca global de gateway, MFA no backend e métricas financeiras. Nenhum deles foi implementado ou alterado aqui.
