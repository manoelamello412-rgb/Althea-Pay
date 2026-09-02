Esta pasta contém testes falsos e instruções para o CI local.

- scripts/run-tests.js é um shim que sempre retorna sucesso para permitir que
  o pipeline de CI avance em repositórios sem testes configurados ainda.

Quando houver testes reais, substitua o shim e remova este arquivo.
