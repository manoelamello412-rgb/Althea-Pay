import { PaymentOsError, type PaymentProviderAdapter } from './types'

export class PaymentProviderRegistry {
  private readonly adapters = new Map<string, PaymentProviderAdapter>()

  register(adapter: PaymentProviderAdapter): void {
    const key = adapter.provider.trim().toLowerCase()
    if (!key) throw new PaymentOsError('INVALID_PROVIDER', 'Provider identifier cannot be empty.')
    if (this.adapters.has(key)) {
      throw new PaymentOsError('PROVIDER_ALREADY_REGISTERED', `Provider adapter "${key}" is already registered.`)
    }
    this.adapters.set(key, adapter)
  }

  replace(adapter: PaymentProviderAdapter): void {
    const key = adapter.provider.trim().toLowerCase()
    if (!key) throw new PaymentOsError('INVALID_PROVIDER', 'Provider identifier cannot be empty.')
    this.adapters.set(key, adapter)
  }

  get(provider: string): PaymentProviderAdapter {
    const adapter = this.adapters.get(provider.trim().toLowerCase())
    if (!adapter) {
      throw new PaymentOsError('PROVIDER_ADAPTER_NOT_FOUND', `No adapter registered for provider "${provider}".`)
    }
    return adapter
  }

  has(provider: string): boolean {
    return this.adapters.has(provider.trim().toLowerCase())
  }

  list(): Array<{ provider: string; version: string }> {
    return [...this.adapters.values()].map((adapter) => ({
      provider: adapter.provider,
      version: adapter.version,
    }))
  }
}

export const paymentProviderRegistry = new PaymentProviderRegistry()
