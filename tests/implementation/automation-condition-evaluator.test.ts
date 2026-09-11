import { describe, expect, it } from "vitest";
import { matchesTrigger } from "../../supabase/functions/automation-engine-v2/condition-evaluator";

describe("automation compound condition evaluator", () => {
  const context = {
    event_type: "checkout.abandoned",
    funnel_id: "funnel-1",
    channel: "whatsapp",
    payload: {
      amount: 149.9,
      customer: { name: "Ana", vip: true },
      occurred_at: "2026-09-11T02:00:00.000Z",
      tags: ["hot", "vip"],
    },
  };

  it("supports AND conditions with numeric, textual, temporal and channel fields", () => {
    expect(matchesTrigger({ event_type: "checkout.abandoned", conditions: [
      { field: "payload.amount", operator: "gte", value: 100 },
      { field: "payload.customer.name", operator: "ieq", value: "ana" },
      { field: "payload.occurred_at", operator: "after", value: "2026-09-10T00:00:00.000Z" },
      { field: "channel", operator: "eq", value: "whatsapp" },
    ] }, context)).toBe(true);
  });

  it("supports nested OR and NOT groups", () => {
    expect(matchesTrigger({ any: [
      { field: "payload.amount", operator: "gt", value: 1000 },
      { all: [
        { field: "payload.customer.vip", operator: "is_true" },
        { not: { field: "channel", operator: "eq", value: "email" } },
      ] },
    ] }, context)).toBe(true);
  });

  it("supports membership and bounded temporal/numeric comparisons", () => {
    expect(matchesTrigger({ conditions: [
      { field: "payload.tags", operator: "contains", value: "vip" },
      { field: "payload.amount", operator: "between", value: [100, 200] },
      { field: "payload.occurred_at", operator: "before", value: "2026-09-12T00:00:00.000Z" },
    ] }, context)).toBe(true);
  });

  it("fails closed for unsupported operators and excessive nesting", () => {
    expect(matchesTrigger({ conditions: [{ field: "payload.amount", operator: "javascript", value: "return true" }] }, context)).toBe(false);
    let nested: Record<string, unknown> = { field: "payload.amount", operator: "eq", value: 149.9 };
    for (let i = 0; i < 14; i++) nested = { all: [nested] };
    expect(matchesTrigger(nested, context)).toBe(false);
  });

  it("does not treat an empty condition set as an implicit match", () => {
    expect(matchesTrigger({ event_type: "checkout.abandoned", conditions: [] }, context)).toBe(false);
  });
});
