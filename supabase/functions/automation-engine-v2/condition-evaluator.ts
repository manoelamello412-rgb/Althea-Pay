export type AutomationContext = {
  event_type?: unknown;
  funnel_id?: unknown;
  channel?: unknown;
  conversation_id?: unknown;
  transaction_id?: unknown;
  checkout_id?: unknown;
  sale_id?: unknown;
  external_id?: unknown;
  payload?: unknown;
  [key: string]: unknown;
};

type JsonRecord = Record<string, unknown>;
const MAX_DEPTH = 12;
const MAX_NODES = 100;

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function ownValue(source: unknown, key: string): unknown {
  if (!isRecord(source) || !Object.prototype.hasOwnProperty.call(source, key)) return undefined;
  return source[key];
}

function valueAt(context: AutomationContext, path: string): unknown {
  const normalized = path.trim();
  if (!normalized) return undefined;
  const direct = ownValue(context, normalized);
  if (direct !== undefined) return direct;
  const parts = normalized.split(".").filter(Boolean);
  if (parts.length === 0) return undefined;
  for (const root of [context, context.payload]) {
    let current: unknown = root;
    let valid = true;
    for (const part of parts) {
      current = ownValue(current, part);
      if (current === undefined) { valid = false; break; }
    }
    if (valid) return current;
  }
  return undefined;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function asDate(value: unknown): number | null {
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.getTime();
  if (typeof value !== "string" && typeof value !== "number") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getTime();
}

function sameValue(actual: unknown, expected: unknown): boolean {
  if (typeof actual === "number" || typeof expected === "number") {
    const a = asNumber(actual);
    const e = asNumber(expected);
    return a !== null && e !== null && a === e;
  }
  return actual === expected;
}

function compareOrdered(actual: unknown, expected: unknown, operator: "gt" | "gte" | "lt" | "lte"): boolean {
  const numericActual = asNumber(actual);
  const numericExpected = asNumber(expected);
  if (numericActual !== null && numericExpected !== null) {
    if (operator === "gt") return numericActual > numericExpected;
    if (operator === "gte") return numericActual >= numericExpected;
    if (operator === "lt") return numericActual < numericExpected;
    return numericActual <= numericExpected;
  }
  const dateActual = asDate(actual);
  const dateExpected = asDate(expected);
  if (dateActual === null || dateExpected === null) return false;
  if (operator === "gt") return dateActual > dateExpected;
  if (operator === "gte") return dateActual >= dateExpected;
  if (operator === "lt") return dateActual < dateExpected;
  return dateActual <= dateExpected;
}

function evaluateOperator(actual: unknown, operator: string, expected: unknown): boolean {
  switch (operator) {
    case "exists": return expected === false ? actual === undefined || actual === null : actual !== undefined && actual !== null;
    case "is_null": return actual === null || actual === undefined;
    case "is_not_null": return actual !== null && actual !== undefined;
    case "is_true": return actual === true;
    case "is_false": return actual === false;
    case "eq": return sameValue(actual, expected);
    case "neq": return !sameValue(actual, expected);
    case "ieq": return typeof actual === "string" && typeof expected === "string" && actual.toLocaleLowerCase() === expected.toLocaleLowerCase();
    case "in": return Array.isArray(expected) && expected.some((candidate) => sameValue(actual, candidate));
    case "not_in": return Array.isArray(expected) && !expected.some((candidate) => sameValue(actual, candidate));
    case "contains": return Array.isArray(actual) ? actual.some((candidate) => sameValue(candidate, expected)) : typeof actual === "string" && typeof expected === "string" && actual.includes(expected);
    case "icontains": return typeof actual === "string" && typeof expected === "string" && actual.toLocaleLowerCase().includes(expected.toLocaleLowerCase());
    case "not_contains": return !evaluateOperator(actual, "contains", expected);
    case "starts_with": return typeof actual === "string" && typeof expected === "string" && actual.startsWith(expected);
    case "ends_with": return typeof actual === "string" && typeof expected === "string" && actual.endsWith(expected);
    case "gt": return compareOrdered(actual, expected, "gt");
    case "gte": return compareOrdered(actual, expected, "gte");
    case "lt": return compareOrdered(actual, expected, "lt");
    case "lte": return compareOrdered(actual, expected, "lte");
    case "before": { const a = asDate(actual); const e = asDate(expected); return a !== null && e !== null && a < e; }
    case "after": { const a = asDate(actual); const e = asDate(expected); return a !== null && e !== null && a > e; }
    case "between": return Array.isArray(expected) && expected.length === 2 && compareOrdered(actual, expected[0], "gte") && compareOrdered(actual, expected[1], "lte");
    default: return false;
  }
}

function evaluateCondition(node: JsonRecord, context: AutomationContext): boolean {
  if (typeof node.field !== "string" || typeof node.operator !== "string") return false;
  return evaluateOperator(valueAt(context, node.field), node.operator, node.value);
}

function evaluateNode(node: unknown, context: AutomationContext, depth: number, budget: { used: number }): boolean {
  if (!isRecord(node) || depth > MAX_DEPTH || budget.used++ >= MAX_NODES) return false;
  const all = Array.isArray(node.all) ? node.all : Array.isArray(node.and) ? node.and : null;
  if (all) return all.length > 0 && all.every((child) => evaluateNode(child, context, depth + 1, budget));
  const any = Array.isArray(node.any) ? node.any : Array.isArray(node.or) ? node.or : null;
  if (any) return any.length > 0 && any.some((child) => evaluateNode(child, context, depth + 1, budget));
  if (Object.prototype.hasOwnProperty.call(node, "not")) return !evaluateNode(node.not, context, depth + 1, budget);
  if (Array.isArray(node.conditions)) {
    const logical = String(node.logical ?? node.operator ?? "and").toLocaleLowerCase();
    if (logical === "or") return node.conditions.length > 0 && node.conditions.some((child) => evaluateNode(child, context, depth + 1, budget));
    if (logical === "and") return node.conditions.length > 0 && node.conditions.every((child) => evaluateNode(child, context, depth + 1, budget));
    return false;
  }
  return evaluateCondition(node, context);
}

export function matchesTrigger(trigger: unknown, context: AutomationContext): boolean {
  if (!isRecord(trigger)) return false;
  if (trigger.event_type !== undefined && trigger.event_type !== "*" && trigger.event_type !== context.event_type) return false;
  if (trigger.funnel_id !== undefined && trigger.funnel_id !== "*" && trigger.funnel_id !== context.funnel_id) return false;
  const budget = { used: 0 };
  if (Array.isArray(trigger.conditions)) {
    const logical = String(trigger.logical ?? "and").toLocaleLowerCase();
    if (logical === "or") return trigger.conditions.length > 0 && trigger.conditions.some((condition) => evaluateNode(condition, context, 0, budget));
    return trigger.conditions.length > 0 && trigger.conditions.every((condition) => evaluateNode(condition, context, 0, budget));
  }
  if (Array.isArray(trigger.all)) return evaluateNode({ all: trigger.all }, context, 0, budget);
  if (Array.isArray(trigger.any)) return evaluateNode({ any: trigger.any }, context, 0, budget);
  if (Object.prototype.hasOwnProperty.call(trigger, "not")) return evaluateNode({ not: trigger.not }, context, 0, budget);
  return true;
}
