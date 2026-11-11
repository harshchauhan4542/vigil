# Webhook test fixtures

`test-cert.pem` / `test-key.pem` are a **self-signed, test-only** key pair generated for the
webhook self-verification tests. They have nothing to do with PayPal's real signing certificate
and are never used outside tests. Do not reuse them anywhere.
