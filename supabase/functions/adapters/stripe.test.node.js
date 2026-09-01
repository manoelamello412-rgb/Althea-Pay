// Lightweight node test runner (no test framework required)
const StripeAdapter = require('./stripe').default || require('./stripe');

(async function() {
  try {
    const adapter = new StripeAdapter();
    const res = await adapter.authorize({ amount: 1000, currency: 'USD' });
    console.log('Stripe adapter sandbox authorize result:', res);
    if (res && res.status === 'approved') process.exit(0);
    console.error('Unexpected adapter response', res);
    process.exit(2);
  } catch (e) {
    console.error('Error running stripe adapter test', e);
    process.exit(3);
  }
})();
