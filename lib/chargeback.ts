// Chargeback evidence collection helpers

export type EvidenceBundle = {
  transaction_id: string;
  merchant_id?: string;
  receipt?: string; // URL or base64
  customer_ip?: string;
  device_fingerprint?: any;
  order_metadata?: Record<string, any>;
  communications?: string; // chat/email transcript
  created_at?: string;
};

export function buildEvidenceBundle(base: Partial<EvidenceBundle>): EvidenceBundle {
  return {
    transaction_id: base.transaction_id || '',
    merchant_id: base.merchant_id,
    receipt: base.receipt,
    customer_ip: base.customer_ip,
    device_fingerprint: base.device_fingerprint,
    order_metadata: base.order_metadata || {},
    communications: base.communications || '',
    created_at: base.created_at || new Date().toISOString(),
  };
}

export async function storeEvidence(bundle: EvidenceBundle) {
  // Placeholder: integrate with DB or object storage (S3) to persist evidence
  // For now, return a simulated reference
  return { ok: true, reference: `evidence_${bundle.transaction_id}_${Date.now()}` };
}
