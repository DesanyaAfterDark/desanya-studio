# Order API (not deployed, not active)

This worker is reviewable code only. `checkout.html` keeps `PAYPAL_ORDER_API` empty, so the live site still creates PayPal orders in the browser. Nothing in this folder has been deployed. No PayPal app was created here, and no secret is stored in git.

Finance Desk, 5 November 2026: the PayPal Business account is live. There is no dashboard-verified live REST app or live REST credential. Live API setup is unknown. A sandbox-only REST app is being handled separately by Finance. Do not create a second app and do not paste secrets into this repository.

## What the worker does, once deployed and switched on

`POST /v1/orders` accepts service ids and quantities only. It prices them from `shared/catalog.js` (rush is 35% of list one-time prices, the November 2026 discount window and code hash, and the $1 monthly-only placeholder). It creates a PayPal Orders v2 order with server OAuth and stores the expected USD amount, cart hash, and an HMAC binding in Workers KV.

`POST /v1/orders/{id}/capture` loads that record. If the id was not created here, it is rejected. The worker reads the order from PayPal and captures it only when the PayPal amount, currency, and `custom_id` match the stored binding. The JSON returned to the browser is the order id, capture id, `COMPLETED`, `USD`, and the amount. It does not include the payer’s name, email, or the access token.

If this URL is later set in checkout and the worker errors, checkout shows an error and does not build a browser-priced PayPal order.

## Official sources checked 5 November 2026

- PayPal Create order: https://developer.paypal.com/api/orders/v2/orders-create
- PayPal Capture payment for order: https://developer.paypal.com/api/orders/v2/orders-capture
- PayPal idempotency (`PayPal-Request-Id`, stored for retries): https://developer.paypal.com/api/rest/reference/idempotency and https://developer.paypal.com/api/make-api-requests
- Orders v2 flow (merchant creates, buyer approves, merchant captures): https://developer.paypal.com/api/rest/integration/orders-api
- Cloudflare Workers pricing, updated 2 October 2026: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers limits, updated 29 October 2026: https://developers.cloudflare.com/workers/platform/limits/
- Workers KV pricing, updated 30 October 2026: https://developers.cloudflare.com/kv/platform/pricing/
- Workers KV limits: https://developers.cloudflare.com/kv/platform/limits/

Workers Free includes 100,000 requests a day and 10 ms of CPU time per invocation. Past the daily request limit, a route can fail open (the Worker is skipped) or fail closed (error 1027). KV on the free plan includes 100,000 reads a day, 1,000 writes a day, and 1 GB. Those are account limits, not a paid invoice from this repository.

## Finance sandbox evidence, 5 November 2026

Finance ran a sandbox connector that can create orders only. These PayPal order ids were reported by Finance. They are not orders this worker created, and they are not completed charges. The connector did not approve a buyer, did not send `PayPal-Request-Id`, and did not repeat a capture. There was no rush-only order and no live call.

| Reported amount | Reported order id | Reported status |
| --- | --- | --- |
| USD 120.00 | 6FL80364DH5630522 | CAPTURE, PAYER_ACTION_REQUIRED |
| USD 900.00 | 8TU49822DN497960K | CAPTURE, PAYER_ACTION_REQUIRED |
| USD 1.00 | 5BG39985YD391084S | CAPTURE, PAYER_ACTION_REQUIRED |
| USD 2,160.00 | 2SV30229790920228 | CAPTURE, PAYER_ACTION_REQUIRED |
| USD 1,125.00 | 7W355404TH1250801 | CAPTURE, PAYER_ACTION_REQUIRED, frozen promo scenario |

An unapproved capture on that connector returned HTTP 422, which matches a payer who has not approved. That 422 is Finance’s report. It is not a capture this worker performed.

Those amounts match this catalog’s math for a $120 one-time total, Website Basic at $900, a monthly-only $1 placeholder, Website Standard plus rush at $2,160, and Website Basic plus rush with the 10% code at $1,125. Matching arithmetic is not proof this worker was called.

A real sandbox test of this worker still has to happen before any live cutover: buyer approval, a completed capture, a repeated capture, and idempotency with `PayPal-Request-Id`. Mocked tests in `tools/check-order-api.mjs` cover those paths with fake PayPal responses. A mocked capture is not a real sandbox capture.

## Transitional risk

Until cutover, a buyer’s browser still decides the PayPal amount. `Object.freeze` on the page catalog only blocks a simple assignment. It is not a security control. The thanks-page text is what that browser saved. It is not a server-issued proof.

Do not describe checkout as server-validated while `PAYPAL_ORDER_API` is empty.

## Owner decisions still required

Do not do these until Cassandra approves them. This pull request does not.

1. Open a free Cloudflare account and confirm the Workers Free plan. Do not enable Workers Paid.
2. Create one Workers KV namespace and bind it as `ORDERS`.
3. Choose the worker hostname. Production and preview must not share a half-configured URL.
4. Set the route to fail closed so a free-quota 1027 does not skip the worker.
5. Finance supplies the REST app out of band. Sandbox credentials stay in the sandbox worker. A live REST app does not exist in the dashboard record Finance checked. Do not point the live website at sandbox credentials, and do not paste either secret into git, chat, or the page.
6. The PayPal JavaScript button client id on the page and the server OAuth client id must be the same REST app. The live page already has a live client id. A sandbox server app will not match it.
7. After a sandbox preview works, approve merge and deployment. Then, in a separate reviewed change, set `PAYPAL_ORDER_API` to the `https` worker origin with no path query or hash.

## Secret storage

Use Cloudflare Worker secrets only (`wrangler secret put` or the dashboard). Never commit them and never send them to the browser.

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `ORDER_BINDING_SECRET` (at least 32 characters, not the PayPal secret)

Dashboard variables, not secrets:

- `PAYPAL_API_BASE` exactly `https://api-m.sandbox.paypal.com` or exactly `https://api-m.paypal.com`
- `ALLOWED_ORIGINS` comma-separated, for example `https://desanya.tech,https://www.desanya.tech`

Unset, wrong, or short values make the worker return `503 not_configured`. It does not create an order.

OAuth is `POST /v1/oauth2/token` with `grant_type=client_credentials` from the worker. The access token stays in the worker.

## Preview and sandbox test plan

Run this only after Finance has issued sandbox credentials into the worker secret store. Do not run it against live.

1. Deploy the worker to a preview hostname with `PAYPAL_API_BASE` set to the sandbox host and `ALLOWED_ORIGINS` set to the preview origin only.
2. On a preview copy of checkout, set `PAYPAL_ORDER_API` to that hostname and the PayPal button client id to the same sandbox app. Leave production `desanya.tech` unchanged.
3. Place one sandbox order for a one-time service, one monthly-only $1 placeholder, and one mixed cart. Confirm PayPal shows the catalog amount, not a number typed in the browser.
4. Confirm a second click with the same cart does not create a second order, a different cart with the same idempotency key is rejected, and an order id that this worker did not create cannot be captured.
5. Stop the worker and confirm the preview checkout shows an error and does not fall back to a browser-priced order.
6. Roll back by clearing `PAYPAL_ORDER_API` on the preview page. Production never had it set.

## Cutover and rollback

Cutover is a later pull request: set `PAYPAL_ORDER_API` on production only after the live REST app exists, the worker is deployed with live secrets, and a sandbox or live smoke test has been accepted. Rollback is setting `PAYPAL_ORDER_API` back to an empty string and redeploying the static page. The worker can stay up; an empty constant means the page does not call it.

## Free-tier operating limits to watch

- 100,000 worker requests a day, then error 1027 if the route is fail closed.
- 10 ms CPU per invocation. This worker’s pricing and one HMAC are small; the PayPal wait is a subrequest, not CPU. Confirm a real invocation in the dashboard before cutover.
- 1,000 KV writes a day. Each new order writes two keys, and a capture writes again. That is enough for this studio’s current volume and too small for a busy day. If writes fail, the worker returns an error and checkout does not fall back.
