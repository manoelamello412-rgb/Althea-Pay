# Integration Event Processor

Internal, service-to-service processor for persisted integration events.

The function is deliberately independent from any real gateway. It consumes the normalized event already stored by the webhook boundary, applies the financial state machine, projects checkout/sale state, then invokes automation and outbound delivery.
