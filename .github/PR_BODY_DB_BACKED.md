---
Resumo
- Preparação do código para operar com persistência em banco: helpers de upsert para idempotency, persistência de webhook_events, stubs de worker para consumir eventos.
- Inclui testes unitários com mocks que não dependem de DB real.

O que foi alterado
- helpers/idempotency.ts (upsert helpers)
- persistence/webhook_events.ts (interfaces + stubs)
- worker stubs e mocks em tests/
- testes unitários cobrindo caminhos happy-path e erros (com mock DB)

Checklist de revisão
- [ ] Revisar APIs dos helpers de idempotency
- [ ] Tests unitários passam localmente: npm test
- [ ] Não há dependências de secrets em tempo de execução dos testes
- [ ] Documentação mínima adicionada (README parcial sobre modelo de dados)

Como testar localmente (sem DB)
- npm ci
- npm test
- Revisar coverage: npm run test -- --coverage (se aplicável)

Observações de implantação
- Estes são preparativos: NÃO aplicam migrações nem se conectam ao DB. Após merge, precisarão de secrets + acesso ao DB para validar E2E e aplicar migrations.

Risco / Impacto
- Médio — alterações nos fluxos de persistência; cobertas por testes com mocks mas requerem validação E2E após prover secrets.

Labels / Reviewers sugeridos
- labels: feature, db
- reviewers: backend-team, @repo-admin
---
