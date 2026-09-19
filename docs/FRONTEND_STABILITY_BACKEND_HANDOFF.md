# Estabilidade do frontend — limites e contratos para Claude

Escopo desta etapa: recuperação de acesso, callbacks de erro do Next, estado/realtime/paginação do CRM e preservação de metadados de produtos. Nenhuma migration, policy, RLS, Edge Function ou lógica financeira foi alterada.

## BACKEND NECESSÁRIO

### 1. Associação inequívoca entre oportunidade e conversa

- **Problema:** a central de recuperação fornece `event_id`, mas não uma conversa canônica. Um evento pode não ter transação; uma transação pode ter mais de uma conversa. E-mail não é vínculo suficiente para escolher uma conversa ou seu contexto financeiro.
- **Contrato esperado:** ampliar o contrato existente de oportunidades com associação autorizada explícita; não criar automaticamente conversas ao abrir um link.
- **Request:** `GET /api/crm/recovery/opportunities` com os filtros já suportados e sessão autenticada. Para um resolvedor específico, receber `{ event_id: UUID }`; o nome definitivo deve ser definido pelo backend antes de implementação.
- **Response por oportunidade:** `{ event_id: UUID, conversation_id: UUID | null, context_status: 'resolved' | 'unlinked' | 'ambiguous', ...camposExistentes }`. Um resolvedor deve retornar esses mesmos campos ou um erro de autorização/não encontrado sem revelar dados de outro tenant.
- **Tipos:** UUID serializado como string; `conversation_id` anulável; enum discriminando ausência de vínculo e ambiguidade.
- **Permissões:** validar sessão, propriedade/organização do evento e da conversa, além das permissões do membro; nunca confiar no ID da URL como autorização.
- **Comportamento esperado:** somente `resolved` abre diretamente a conversa. Outros estados pedem seleção explícita, sem usar e-mail como aproximação e sem enviar mensagens ou acionar recuperação automaticamente.
- **Mitigação frontend implementada:** consulta de leitura do evento e busca pela transação, ambas com `user_id`. Só seleciona quando encontra exatamente uma conversa. Sem vínculo inequívoco, informa a limitação. Eventos do painel lateral só são aceitos quando possuem a mesma transação da conversa selecionada.

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
