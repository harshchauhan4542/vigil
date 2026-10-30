# Vigil

**An AI money-ops control room for PayPal merchants.**

Vigil watches a merchant's PayPal account for money exceptions: failed subscription renewals, captured orders without tracking, authorization holds about to expire, and transactions that don't match the books. It puts them all in one prioritized queue. A Claude agent investigates each exception and *proposes* a fix. A deterministic policy engine and a human approval decide what runs. Approved actions execute against PayPal with idempotency keys and are confirmed by verified webhooks.

> Status: under active development for the PayPal AI Hackathon 2026. Runs against the PayPal **sandbox** only.

## License

[MIT](./LICENSE)
