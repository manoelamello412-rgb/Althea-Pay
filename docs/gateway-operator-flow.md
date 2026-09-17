# Gateway operator flow

The operator-facing connection flow is provider-driven:

1. Select a registered provider/adapter.
2. Select environment.
3. Enter only credentials declared as operational credentials by the provider schema.
4. Save the connection through `register_dynamic_gateway`.
5. Validate it through `gateway-connection-test`.
6. The runtime resolves provider execution/webhook configuration server-side.

Transport configuration (base URL, authentication headers/prefixes, endpoint paths, HTTP methods, request/response mappings, status mapping, idempotency and webhook transport) is provider/adapter configuration. It is not collected as connection credentials.

A provider can declare a credential field with `section: "technical"`; the operator UI must never expose that field in the normal connection form. Custom provider administration is a separate technical workflow.
