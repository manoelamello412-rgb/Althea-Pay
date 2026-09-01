# PCI Considerations

Althea Pay is designed as a control plane and not a payment custodian. The repository contains a PCI-safe architecture recommendation and technical controls to avoid storage of PAN/CVC.

Key points:
- Do not store PAN/CVC anywhere in the database or logs.
- Validate that all upstream gateways provide tokenization/hosted fields.
- Use PCI SAQ guidance to map responsibilities between Althea and external gateways.

Files added:
- docs/PCI.md
