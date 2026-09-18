/** Validate the database boundary before persisting a routing decision. */
export function candidateGatewayIds(value: unknown, requested: Set<string>): string[] {
  if (!Array.isArray(value)) throw new Error("invalid_gateway_ranking_response")
  const seen = new Set<string>()
  for (const row of value) {
    if (!row || typeof row !== "object" || Array.isArray(row)
      || typeof row.gateway_id !== "string" || !requested.has(row.gateway_id)
      || seen.has(row.gateway_id)
      || typeof row.routing_score !== "number" || !Number.isFinite(row.routing_score)
      || typeof row.healthy !== "boolean" || typeof row.circuit_state !== "string"
      || row.circuit_state === "open") {
      throw new Error("invalid_gateway_ranking_response")
    }
    seen.add(row.gateway_id)
  }
  return [...seen].slice(0, 8)
}
