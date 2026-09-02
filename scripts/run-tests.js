#!/usr/bin/env node
// Lightweight test shim used in CI when no tests are configured.
// Exits 0 so CI won't fail when there are no unit tests present.

console.log('Info: Running repository test shim — no real tests configured. Exiting success.');
process.exit(0);
