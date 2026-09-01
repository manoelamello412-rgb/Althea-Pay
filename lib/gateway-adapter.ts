export type GatewayResponse = {
  id: string;
  status: 'approved' | 'declined' | 'error' | 'pending';
  amount: number;
  currency: string;
  raw?: any; // gateway specific payload
};

export type GatewayAuthParams = {
  amount: number;
  currency: string;
  metadata?: Record<string, any>;
  idempotencyKey?: string;
};

export interface GatewayAdapter {
  // Authorize a payment (can be capture later)
  authorize(params: GatewayAuthParams): Promise<GatewayResponse>;

  // Capture an already authorized payment
  capture(authorizationId: string, amount?: number): Promise<GatewayResponse>;

  // Refund a captured payment (partial/full)
  refund(transactionId: string, amount?: number): Promise<GatewayResponse>;

  // Void an uncaptured authorization
  void(authorizationId: string): Promise<GatewayResponse>;

  // Health check for routing/circuit-breaker
  healthCheck(): Promise<{ ok: boolean; details?: any }>;

  // Handle incoming webhooks from this gateway
  handleWebhook(rawBody: any, headers: Record<string,string>): Promise<{ ok: boolean; event?: any }>;
}
