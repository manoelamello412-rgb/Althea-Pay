import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import process from "node:process";

const root = process.cwd();
const npm = process.platform === "win32" ? "npm.cmd" : "npm";

const steps = [
  { name: "TypeScript strict", command: npm, args: ["run", "typecheck"] },
  { name: "ESLint", command: npm, args: ["run", "lint"] },
  { name: "Testes", command: npm, args: ["test"] },
  { name: "Release preflight", command: npm, args: ["run", "preflight"] },
  { name: "Build de produção", command: npm, args: ["run", "build"] },
];

const migrationDir = "supabase/migrations";
const hasSupabaseConfig = existsSync(`${root}/supabase/config.toml`);
const hasMigrationDirectory = existsSync(`${root}/${migrationDir}`);

function runStep(step) {
  process.stdout.write(`\n[GATEWAY] ${step.name}\n`);
  const result = spawnSync(step.command, step.args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.error) {
    throw new Error(`${step.name}: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`${step.name}: processo encerrado com código ${result.status ?? "desconhecido"}`);
  }
}

function readConfiguredProjectId() {
  const config = readFileSync(`${root}/supabase/config.toml`, "utf8");
  const match = config.match(/^project_id\s*=\s*"([^"]+)"/m);
  return match?.[1] ?? null;
}

function validateRepositoryLayout() {
  process.stdout.write("\n[GATEWAY] Validando estrutura do módulo\n");

  const requiredPaths = [
    "lib/gateway-adapter.ts",
    "supabase/functions/gateway-orchestrator/index.ts",
    "supabase/functions/_shared/gateway-universal-contract.ts",
  ];

  const missing = requiredPaths.filter((path) => !existsSync(`${root}/${path}`));
  if (missing.length > 0) {
    throw new Error(`Arquivos fundamentais do Multi-Gateway ausentes: ${missing.join(", ")}`);
  }

  if (!hasMigrationDirectory) {
    throw new Error("Diretório supabase/migrations não encontrado; execução interrompida para evitar estado inconsistente.");
  }
}

function validateSupabaseConfiguration() {
  process.stdout.write("\n[GATEWAY] Validando configuração do Supabase\n");

  if (!hasSupabaseConfig) {
    throw new Error("supabase/config.toml não encontrado; migrations não podem ser validadas com segurança.");
  }

  const requiredEnv = ["SUPABASE_ACCESS_TOKEN", "SUPABASE_PROJECT_ID", "SUPABASE_DB_PASSWORD"];
  const missing = requiredEnv.filter((name) => !process.env[name]);
  if (missing.length > 0) {
    throw new Error(`Configuração de CI incompleta para migrations remotas: ${missing.join(", ")}`);
  }

  const configuredProjectId = readConfiguredProjectId();
  if (!configuredProjectId || configuredProjectId !== process.env.SUPABASE_PROJECT_ID) {
    throw new Error("SUPABASE_PROJECT_ID não corresponde ao project_id canônico de supabase/config.toml.");
  }

  return true;
}

function runSupabaseCommand(args) {
  const supabaseCommand = process.platform === "win32" ? "supabase.exe" : "supabase";
  const result = spawnSync(supabaseCommand, args, {
    cwd: root,
    stdio: "inherit",
    shell: false,
    env: process.env,
  });

  if (result.error) {
    throw new Error(`Supabase CLI indisponível: ${result.error.message}`);
  }

  if (result.status !== 0) {
    throw new Error(`supabase ${args.join(" ")} falhou com código ${result.status ?? "desconhecido"}`);
  }
}

function applyMigrations() {
  validateSupabaseConfiguration();

  process.stdout.write("\n[GATEWAY] Vinculando projeto Supabase canônico\n");
  runSupabaseCommand([
    "link",
    "--project-ref",
    process.env.SUPABASE_PROJECT_ID,
    "--password",
    process.env.SUPABASE_DB_PASSWORD,
  ]);

  process.stdout.write("\n[GATEWAY] Aplicando migrations Supabase\n");
  runSupabaseCommand([
    "db",
    "push",
    "--linked",
    "--password",
    process.env.SUPABASE_DB_PASSWORD,
  ]);
}

function main() {
  const startedAt = Date.now();
  process.stdout.write("ALTHEA PAY — MULTI-GATEWAY ORCHESTRATOR\n");
  process.stdout.write("Execução determinística: falha em qualquer etapa crítica interrompe o pipeline.\n");

  validateRepositoryLayout();
  applyMigrations();

  for (const step of steps) runStep(step);

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  process.stdout.write(`\n[GATEWAY] FINALIZADO COM SUCESSO em ${elapsed}s\n`);
  process.stdout.write("[GATEWAY] Código, testes, preflight e build passaram sem erro.\n");
}

try {
  main();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[GATEWAY] EXECUÇÃO INTERROMPIDA: ${message}\n`);
  process.exitCode = 1;
}