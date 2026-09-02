---
Resumo
- Ajustes para CI rodar em ambientes sem secrets: noop typecheck, correções de scripts, atualização de workflows de lint/test para rodarem sem dependências externas.
- Objetivo: garantir que checks básicos (lint, unit tests) passem em PRs e branches de feature antes de disponibilizar secrets.

O que foi alterado
- Adicionado script npm "typecheck" noop.
- Atualizações em workflows: lint, unit-tests (remover dependência obrigatória de secrets).
- Pequenas correções de scripts de build/test que falhavam em CI sem DB.

Checklist de revisão
- [ ] Lint passa localmente: npm run lint
- [ ] Unit tests (mocked) rodam: npm test
- [ ] Workflows listados (Actions) aparecem e não exigem secrets para execução básica

Como testar localmente
- Instalar dependências: npm ci
- Rodar lint: npm run lint
- Rodar testes: npm test

Risco / Impacto
- Baixo — apenas mudanças de CI e scripts; não altera lógica de negócio.

Labels / Reviewers sugeridos
- labels: chore, ci
- reviewers: @repo-admin (ou quem gerencia CI)
---
