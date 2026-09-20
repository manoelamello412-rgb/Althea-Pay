import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { matchesTrigger } from "./condition-evaluator.ts";

const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
const json = (x: unknown, s = 200) => new Response(JSON.stringify(x), { status: s, headers: { "content-type": "application/json" } });
const automationBackoffMs = (attemptCount: number) => Math.min(3600000, 30000 * Math.pow(2, Math.max(0, attemptCount - 1)));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function requireSameOrganization(expected: string, actual: unknown, error = "organization_mismatch") {
  if (String(actual ?? "") !== expected) throw Error(error);
}

async function validateContext(c: any) {
  if (!c.user_id || !c.event_type) throw Error("user_id_and_event_type_required");
  if (!uuidPattern.test(String(c.organization_id ?? ""))) throw Error("organization_id_required");

  const { data: organization, error: organizationError } = await db
    .from("organizations")
    .select("id")
    .eq("id", c.organization_id)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) throw Error("organization_not_found");

  const { data: membership, error: membershipError } = await db
    .from("organization_members")
    .select("organization_id,user_id")
    .eq("organization_id", c.organization_id)
    .eq("user_id", c.user_id)
    .maybeSingle();
  if (membershipError) throw membershipError;
  if (!membership) throw Error("organization_membership_required");

  if (c.event_id) {
    const { data: event, error: eventError } = await db
      .from("integration_events")
      .select("id,organization_id,user_id")
      .eq("id", c.event_id)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .maybeSingle();
    if (eventError) throw eventError;
    if (!event) throw Error("integration_event_tenant_mismatch");
  }
}

async function stableKey(c: any, ruleId: string) {
  const explicit = c.event_id || c.external_id || c.transaction_id || c.checkout_id || c.sale_id;
  if (explicit) return `${c.organization_id}:${String(explicit)}:${ruleId}`;
  const canonical = JSON.stringify({
    organization_id: c.organization_id,
    event_type: c.event_type,
    funnel_id: c.funnel_id,
    conversation_id: c.conversation_id,
    payload: c.payload,
  });
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonical));
  const hash = Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${c.organization_id}:${c.event_type}:${hash}:${ruleId}`;
}

async function requireConversation(conversationId: string, c: any) {
  const { data, error } = await db
    .from("crm_conversations")
    .select("id,organization_id")
    .eq("id", conversationId)
    .eq("organization_id", c.organization_id)
    .eq("user_id", c.user_id)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw Error("CONVERSATION_NOT_FOUND");
  return data;
}

async function runSingleAction(cfg: any, rule: any, c: any, actionIndex = 0) {
  requireSameOrganization(c.organization_id, rule.organization_id, "rule_organization_mismatch");
  const type = cfg.type || cfg.action || "log";

  if (type === "log" || type === "alert") {
    const executionKey = await stableKey(c, rule.id);
    const logId = `automation:${executionKey}:action:${actionIndex}`;
    const { error } = await db.from("logs").insert({
      id: logId,
      user_id: c.user_id,
      user_name: "automation",
      action: `automation:${type}`,
      resource: c.event_type,
      details: JSON.stringify({ organization_id: c.organization_id, rule_id: rule.id, funnel_id: c.funnel_id, payload: c.payload }),
    });
    if (error?.code === "23505") return { type, logged: true, deduplicated: true };
    if (error) throw error;
    return { type, logged: true, deduplicated: false };
  }

  if (type === "send_crm_message") {
    const conversationId = c.conversation_id ?? c.payload?.conversation_id;
    if (!conversationId) throw Error("conversation_id_required");
    await requireConversation(String(conversationId), c);

    const channel = String(cfg.channel || "funnel_chat");
    if (!["funnel_chat", "whatsapp", "instagram", "messenger", "email", "sms"].includes(channel)) throw Error("channel_not_configured");
    const body = String(cfg.body ?? cfg.message ?? "").trim();
    if (!body) throw Error("message_body_required");

    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(body));
    const hash = Array.from(new Uint8Array(digest)).map((x) => x.toString(16).padStart(2, "0")).join("");
    const sourceIdentity = c.event_id || c.external_id || c.transaction_id || c.checkout_id || c.sale_id || c.conversation_id;
    const idempotency = `automation:${c.organization_id}:${rule.id}:${sourceIdentity}:${channel}:${hash}`;

    if (channel === "funnel_chat") {
      const { data, error } = await db.from("crm_messages").insert({
        organization_id: c.organization_id,
        conversation_id: conversationId,
        user_id: c.user_id,
        direction: "outbound",
        channel,
        body,
        client_message_id: idempotency,
        metadata: { automation_rule_id: rule.id, automated: true },
      }).select("id,conversation_id,direction,channel,body,created_at").single();

      if (!error) return { type, message: data, queued: false };
      if (error.code !== "23505") throw error;

      const { data: existing, error: existingError } = await db
        .from("crm_messages")
        .select("id,conversation_id,direction,channel,body,created_at")
        .eq("organization_id", c.organization_id)
        .eq("user_id", c.user_id)
        .eq("client_message_id", idempotency)
        .maybeSingle();
      if (existingError) throw existingError;
      if (!existing) throw error;
      return { type, message: existing, queued: false, deduplicated: true };
    }

    const channelAccountId = String(cfg.channel_account_id || cfg.account_id || "").trim();
    if (!channelAccountId) throw Error("channel_account_id_required");
    const { data: account, error: accountError } = await db
      .from("crm_channel_accounts")
      .select("id,organization_id")
      .eq("id", channelAccountId)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .eq("channel", channel)
      .eq("status", "active")
      .maybeSingle();
    if (accountError) throw accountError;
    if (!account) throw Error("CHANNEL_ACCOUNT_NOT_FOUND_OR_INACTIVE");

    const { data, error } = await db.from("crm_channel_message_outbox").upsert({
      organization_id: c.organization_id,
      user_id: c.user_id,
      conversation_id: conversationId,
      channel_account_id: channelAccountId,
      channel,
      direction: "outbound",
      body,
      status: "queued",
      max_attempts: Number(cfg.max_attempts || 5),
      next_attempt_at: new Date().toISOString(),
      idempotency_key: idempotency,
      metadata: { automation_rule_id: rule.id, automated: true },
    }, { onConflict: "user_id,idempotency_key", ignoreDuplicates: true })
      .select("id,status,channel,conversation_id,created_at")
      .maybeSingle();
    if (error) throw error;
    return { type, queued: true, outbox: data };
  }

  if (type === "set_conversation_status") {
    const conversationId = c.conversation_id ?? c.payload?.conversation_id;
    if (!conversationId) throw Error("conversation_id_required");
    await requireConversation(String(conversationId), c);

    const status = String(cfg.status || "open");
    if (!["open", "pending", "closed"].includes(status)) throw Error("invalid_conversation_status");
    const { data, error } = await db.from("crm_conversations")
      .update({ status, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .select("id,status,updated_at")
      .single();
    if (error) throw error;
    return { type, conversation: data };
  }

  if (type === "handoff_conversation") {
    const conversationId = c.conversation_id ?? c.payload?.conversation_id;
    if (!conversationId) throw Error("conversation_id_required");
    await requireConversation(String(conversationId), c);

    const assignedTo = String(cfg.assigned_to || cfg.agent_id || "").trim();
    if (!assignedTo) throw Error("assigned_to_required");
    const { data: agent, error: agentError } = await db
      .from("crm_agents")
      .select("id,organization_id")
      .eq("id", assignedTo)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .maybeSingle();
    if (agentError) throw agentError;
    if (!agent) throw Error("AGENT_NOT_FOUND");

    const { data, error } = await db.from("crm_conversations")
      .update({ assigned_to: assignedTo, updated_at: new Date().toISOString() })
      .eq("id", conversationId)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .select("id,assigned_to,updated_at")
      .single();
    if (error) throw error;
    return { type, conversation: data };
  }

  if (type === "update_transaction") {
    if (!c.transaction_id) throw Error("transaction_id_required");

    const { data: current, error: currentError } = await db
      .from("gateway_transactions")
      .select("id,status,error_message,version,organization_id")
      .eq("id", c.transaction_id)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .maybeSingle();
    if (currentError) throw currentError;
    if (!current) throw Error("TRANSACTION_NOT_FOUND");

    let data: any = current;
    if (cfg.status) {
      const { data: transition, error } = await db.rpc("transition_gateway_transaction_status", {
        p_transaction_id: c.transaction_id,
        p_user_id: c.user_id,
        p_next_status: String(cfg.status),
        p_failure_code: cfg.error_message ? String(cfg.error_message) : null,
        p_external_id: null,
        p_expected_version: Number(current.version),
      });
      if (error) throw error;
      requireSameOrganization(c.organization_id, transition?.organization_id, "transaction_organization_mismatch");
      data = transition;
    }

    if (cfg.error_message) {
      const { data: updated, error } = await db.from("gateway_transactions")
        .update({ error_message: String(cfg.error_message) })
        .eq("id", c.transaction_id)
        .eq("organization_id", c.organization_id)
        .eq("user_id", c.user_id)
        .select("id,status,error_message,organization_id")
        .single();
      if (error) throw error;
      requireSameOrganization(c.organization_id, updated.organization_id, "transaction_organization_mismatch");
      data = updated;
    }

    return { type, transaction: data };
  }

  if (type === "recover_checkout") {
    if (!c.checkout_id) throw Error("checkout_id_required");
    const next = new Date(Date.now() + Number(cfg.delay_minutes || 0) * 60000).toISOString();
    const { data, error } = await db.from("checkout_sessions")
      .update({ abandoned_at: new Date().toISOString(), recovery_status: "pending", recovery_next_at: next, updated_at: new Date().toISOString() })
      .eq("id", c.checkout_id)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .select("id,recovery_status,recovery_next_at,organization_id")
      .single();
    if (error) throw error;
    requireSameOrganization(c.organization_id, data.organization_id, "checkout_organization_mismatch");
    return { type, checkout: data };
  }

  if (type === "update_sale") {
    if (!c.sale_id && !c.external_id) throw Error("sale_identifier_required");

    let sale: any = null;
    if (c.sale_id) {
      const { data, error } = await db.from("sales")
        .select("id,status,organization_id")
        .eq("id", c.sale_id)
        .eq("organization_id", c.organization_id)
        .eq("user_id", c.user_id)
        .maybeSingle();
      if (error) throw error;
      sale = data;
    } else {
      const { data, error } = await db.from("sales")
        .select("id,status,organization_id")
        .eq("organization_id", c.organization_id)
        .eq("user_id", c.user_id)
        .eq("external_id", c.external_id)
        .limit(2);
      if (error) throw error;
      if ((data ?? []).length > 1) throw Error("SALE_EXTERNAL_ID_AMBIGUOUS");
      sale = data?.[0] ?? null;
    }

    if (!sale) throw Error("SALE_NOT_FOUND");
    requireSameOrganization(c.organization_id, sale.organization_id, "sale_organization_mismatch");

    const { data, error } = await db.from("sales")
      .update({ status: cfg.status || "updated", occurred_at: new Date().toISOString() })
      .eq("id", sale.id)
      .eq("organization_id", c.organization_id)
      .eq("user_id", c.user_id)
      .select("id,status,organization_id")
      .single();
    if (error) throw error;
    requireSameOrganization(c.organization_id, data.organization_id, "sale_organization_mismatch");
    return { type, sale: data };
  }

  throw Error(`unsupported_action:${type}`);
}

async function runAction(rule: any, c: any) {
  requireSameOrganization(c.organization_id, rule.organization_id, "rule_organization_mismatch");
  const root = rule.action_config || {};
  const actions = Array.isArray(root.actions) ? root.actions : [root];
  if (!actions.length) throw Error("actions_required");
  const stopOnError = root.stop_on_error !== false;
  const outputs: unknown[] = [];
  for (let actionIndex = 0; actionIndex < actions.length; actionIndex += 1) {
    const cfg = actions[actionIndex];
    try {
      outputs.push(await runSingleAction(cfg, rule, c, actionIndex));
    } catch (error) {
      if (stopOnError) throw error;
      outputs.push({ type: cfg.type || cfg.action || "unknown", error: error instanceof Error ? error.message : String(error) });
    }
  }
  return actions.length === 1 && !Array.isArray(root.actions)
    ? outputs[0]
    : { type: "multi_action", stop_on_error: stopOnError, actions: outputs };
}

async function executeExistingRetry(executionId: string) {
  const { data: execution, error: executionError } = await db
    .from("automation_executions")
    .select("id,user_id,organization_id,rule_id,status,input,attempt_count,max_attempts")
    .eq("id", executionId)
    .maybeSingle();
  if (executionError) throw executionError;
  if (!execution) throw Error("RETRY_EXECUTION_NOT_FOUND");
  if (execution.status !== "running") throw Error("RETRY_EXECUTION_NOT_CLAIMED");
  if (!uuidPattern.test(String(execution.organization_id ?? ""))) throw Error("RETRY_ORGANIZATION_INVALID");

  const { data: rule, error: ruleError } = await db
    .from("automation_rules")
    .select("*")
    .eq("id", execution.rule_id)
    .eq("user_id", execution.user_id)
    .eq("organization_id", execution.organization_id)
    .maybeSingle();
  if (ruleError) throw ruleError;
  if (!rule) throw Error("RETRY_RULE_NOT_FOUND");

  const c = execution.input;
  if (!c || typeof c !== "object") throw Error("RETRY_INPUT_INVALID");
  requireSameOrganization(execution.organization_id, rule.organization_id, "retry_rule_organization_mismatch");
  requireSameOrganization(execution.organization_id, c.organization_id, "retry_input_organization_mismatch");
  if (String(c.user_id ?? "") !== String(execution.user_id)) throw Error("retry_user_mismatch");

  try {
    const output = await runAction(rule, c);
    const { error: updateError } = await db.from("automation_executions")
      .update({ status: "completed", output, completed_at: new Date().toISOString(), next_retry_at: null, error_message: null })
      .eq("id", executionId)
      .eq("organization_id", execution.organization_id)
      .eq("status", "running");
    if (updateError) throw updateError;
    return { execution_id: executionId, status: "completed", output };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const terminal = Number(execution.attempt_count) >= Number(execution.max_attempts);
    if (terminal) {
      const { error: deadLetterError } = await db.rpc("crm_mark_automation_dead_letter", { p_execution_id: executionId, p_error: message });
      if (deadLetterError) throw deadLetterError;
      return { execution_id: executionId, status: "dead_letter", error: message };
    }

    const nextAttempt = Number(execution.attempt_count);
    const nextRetry = new Date(Date.now() + automationBackoffMs(nextAttempt)).toISOString();
    const { error: updateError } = await db.from("automation_executions")
      .update({ status: "failed", error_message: message, completed_at: new Date().toISOString(), attempt_count: nextAttempt, next_retry_at: nextRetry })
      .eq("id", executionId)
      .eq("organization_id", execution.organization_id)
      .eq("status", "running");
    if (updateError) throw updateError;
    return { execution_id: executionId, status: "failed", error: message, next_retry_at: nextRetry, attempt_count: nextAttempt };
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  const secret = Deno.env.get("ALTHEA_INTERNAL_SECRET") || "";
  if (!secret || req.headers.get("x-internal-secret") !== secret) return json({ error: "unauthorized" }, 401);

  try {
    const body = await req.json();
    if (body.retry_execution_id) return json(await executeExistingRetry(String(body.retry_execution_id)));

    const c = {
      user_id: body.user_id,
      organization_id: body.organization_id,
      funnel_id: body.funnel_id ?? null,
      event_id: body.event_id ?? null,
      event_type: body.event_type,
      channel: body.channel ?? body.payload?.channel ?? null,
      conversation_id: body.conversation_id ?? body.payload?.conversation_id ?? null,
      transaction_id: body.transaction_id ?? body.payload?.transaction_id,
      checkout_id: body.checkout_id ?? body.payload?.checkout_id,
      sale_id: body.sale_id ?? body.payload?.sale_id,
      external_id: body.external_id ?? body.payload?.external_id,
      payload: body.payload ?? {},
    };

    try {
      await validateContext(c);
    } catch (error) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 400);
    }

    const { data: rules, error } = await db.from("automation_rules")
      .select("*")
      .eq("user_id", c.user_id)
      .eq("organization_id", c.organization_id)
      .eq("status", "active");
    if (error) throw error;

    const results: any[] = [];
    for (const rule of rules || []) {
      requireSameOrganization(c.organization_id, rule.organization_id, "rule_organization_mismatch");
      if (!matchesTrigger(rule.trigger_config || {}, c)) continue;

      const { data: allowed, error: rateError } = await db.rpc("crm_check_automation_rate_limit_org", {
        p_organization_id: c.organization_id,
        p_rule_id: rule.id,
        p_limit: 60,
        p_window_seconds: 60,
      });
      if (rateError) throw rateError;

      if (allowed === false) {
        const { data: limited, error: limitedError } = await db.from("automation_executions").insert({
          user_id: c.user_id,
          organization_id: c.organization_id,
          rule_id: rule.id,
          event_id: c.event_id,
          execution_key: await stableKey(c, rule.id),
          status: "failed",
          action_type: Array.isArray(rule.action_config?.actions) ? "multi_action" : ((rule.action_config || {}).type || (rule.action_config || {}).action || "log"),
          input: c,
          error_message: "automation_rate_limited",
          started_at: new Date().toISOString(),
          completed_at: new Date().toISOString(),
          attempt_count: 1,
          next_retry_at: new Date(Date.now() + automationBackoffMs(1)).toISOString(),
        }).select("id").single();

        if (limitedError?.code === "23505") {
          results.push({ rule_id: rule.id, status: "skipped", reason: "duplicate" });
          continue;
        }
        if (limitedError) throw limitedError;
        results.push({ rule_id: rule.id, status: "failed", reason: "rate_limited", execution_id: limited?.id });
        continue;
      }

      const key = await stableKey(c, rule.id);
      const { data: execution, error: insertError } = await db.from("automation_executions").insert({
        user_id: c.user_id,
        organization_id: c.organization_id,
        rule_id: rule.id,
        event_id: c.event_id,
        execution_key: key,
        status: "running",
        action_type: Array.isArray(rule.action_config?.actions) ? "multi_action" : ((rule.action_config || {}).type || (rule.action_config || {}).action || "log"),
        input: c,
        started_at: new Date().toISOString(),
        attempt_count: 1,
      }).select("id").single();

      if (insertError?.code === "23505") {
        results.push({ rule_id: rule.id, status: "skipped", reason: "duplicate" });
        continue;
      }
      if (insertError) throw insertError;

      try {
        const output = await runAction(rule, c);
        const { error: updateError } = await db.from("automation_executions")
          .update({ status: "completed", output, completed_at: new Date().toISOString(), attempt_count: 1 })
          .eq("id", execution.id)
          .eq("organization_id", c.organization_id)
          .eq("status", "running");
        if (updateError) throw updateError;
        results.push({ rule_id: rule.id, status: "completed", output });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const nextRetry = new Date(Date.now() + automationBackoffMs(1)).toISOString();
        const { error: updateError } = await db.from("automation_executions")
          .update({ status: "failed", error_message: message, completed_at: new Date().toISOString(), attempt_count: 1, next_retry_at: nextRetry })
          .eq("id", execution.id)
          .eq("organization_id", c.organization_id)
          .eq("status", "running");
        if (updateError) throw updateError;
        results.push({ rule_id: rule.id, status: "failed", error: message, next_retry_at: nextRetry });
      }
    }

    return json({ ok: true, matched: results.length, results });
  } catch (error) {
    return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500);
  }
});
