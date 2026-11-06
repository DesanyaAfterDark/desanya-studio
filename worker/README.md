# Order API (not deployed, not active)

This worker is reviewable code only. `checkout.html` keeps `PAYPAL_ORDER_API` empty, so the live site still creates PayPal orders in the browser. Nothing in this folder has been deployed. No PayPal app was created here, and no secret is stored in git.

The merged worker at `384a032087a42b67b61c5f6e7e14a7b16dcaccc8` stores orders in Workers KV. That package is a sandbox upload only. KV get-then-put is not exactly-once. This revision stores orders in one SQLite Durable Object instead. Do not deploy the KV package to live checkout.

Finance Desk, 5 November 2026: the PayPal Business account is live. There is no dashboard-verified live REST app or live REST credential. Live API setup is unknown. A sandbox-only REST app is being handled separately by Finance. Do not create a second app and do not paste secrets into this repository.

## What the worker does, once deployed and switched on

`POST /v1/orders` accepts service ids and quantities only. It prices them from `shared/catalog.js` (rush is 35% of list one-time prices, the November 2026 discount window and code hash, and the $1 monthly-only placeholder). It creates a PayPal Orders v2 order with server OAuth. The expected USD amount, cart hash, line items, and an HMAC binding are stored in one SQLite Durable Object named `desanya-orders`.

`POST /v1/orders/{id}/capture` loads that record. If the id was not created here, it is rejected. The worker reads the order from PayPal and captures it only when the PayPal amount, currency, and `custom_id` match the stored binding. The JSON returned to the browser is the order id, capture id, `COMPLETED`, `USD`, and the amount. The capture request that owns the receipt also receives a `receiptToken`. A later capture call with a different idempotency key does not receive that token. The response does not include the payer’s name, email, or the access token.

`GET /v1/orders/{id}/receipt` returns the itemized receipt only when the `receipt-token` header matches the token stored for that completed capture. A wrong token, a missing token, and an unknown order all return the same `404` body. The receipt body is the order id, capture id, server timestamp, catalog line items, USD amount, the business name Desanya Studio, and the public contact `desanyaafterdark@gmail.com`. It does not include a buyer email.

There is no `/health` route. There is no email send.

If checkout is later pointed at this worker and the worker errors, checkout shows an error and does not build a browser-priced PayPal order.

## KV is not exactly-once

Workers KV is eventually consistent. A get that misses, followed by a put, can run twice when two requests overlap or land on different locations. Those two requests can create two PayPal orders, start two captures, or hand out two receipt links. The merged KV worker must not be described as exactly-once and must not be the live store.

This worker keeps the reservation and the capture request id inside one SQLite Durable Object. The check and the insert do not await between them. A second request for the same idempotency key, while the first PayPal call is still running, gets `409 order_in_progress` and does not start another PayPal order. A second capture, while the first capture is still running, gets `409 capture_in_progress` and does not mint a second `PayPal-Request-Id`. After a storage or PayPal error, a retry reuses the same PayPal request id. That is the Free-plan lock. It is not a claim that PayPal itself can never show two HTTP attempts, and it is not a claim about Workers KV.

SQLite Durable Objects are on the Workers Free plan. Key-value Durable Objects are not. Do not upgrade the account to Workers Paid to get them.

## Receipt page

`/receipt/` on the site shows a receipt only after it loads the GET above. Amounts, status, items, and email in the page address are ignored. `sessionStorage` is ignored. The Print button calls `window.print()`. Saving a PDF is the browser print dialog. The page does not send email.

PayPal’s own payment notification is a different message. Orders v2 create and capture do not provide a merchant receipt-send call or `receipt_email`. This worker does not call PayPal for email, and it does not say an email was delivered. No Resend, Brevo, or other sender is included. A provider has not been chosen.

The receipt link is a secret. Anyone who has the token can open that one receipt. The order id by itself is not enough.

The amount paid is the PayPal capture. A monthly service is not part of that capture. Its catalog price is stored with the requested cart and shown as billed later. A monthly-only cart still pays the $1 deposit today. Two different monthly services are different commitments even though both deposits are $1.00. The cart hash includes the requested slugs, quantities, and catalog unit prices. It does not read a price sent by the browser.

Create returns a random owner secret once. Only its SHA-256 is stored. Capture and a create replay must send that secret in the `order-owner` header. A caller who knows the order id and invents a capture idempotency key is rejected and receives no amount, capture id, or receipt token. The idempotency key is not ownership. The secret is not put in the page address, the PayPal order, or a log line from this worker. Orders created before this binding have no stored hash. Their older capture behavior is not ownership security, and this code does not invent secrets for them.

PayPal JavaScript checkout uses `createOrder` and `onApprove`. It does not need `return_url` or `cancel_url`. Those fields are required only inside `payment_source.paypal.experience_context`, which is the redirect approval flow. This worker does not send that object. A standalone approval URL that stays on “Loading…” after Review Order has no SDK callback and no return URL; that observation is not proof the button flow failed, and it is not a reason to add an open redirect.

## Sandbox baseline at b5994f9

These three captures were reported from the isolated sandbox worker built from `b5994f9`, before the commitment and owner-secret changes. They are baseline evidence. They are not a test of the revision that adds the later-billing section and the owner secret. No payer email and no capability token is recorded here.

| Cart | Order | Capture | Result |
| --- | --- | --- | --- |
| Blog, USD 120.00 | 25N769370G6783016 | 25K87359FD454380K | COMPLETED. The first capture and a replay with the same key returned the same capture. |
| Monthly care deposit, USD 1.00 | 15Y25252071631202 | 1ND85724G7049235W | COMPLETED. The stored paid line is the deposit label for Monthly care — Basic. The future USD 99.00 catalog price was not stored. |
| Website Basic plus monthly care, USD 900.00 | 2PY93873143038723 | 1NL607579C837290D | COMPLETED. PayPal and the paid lines show Website — Basic at USD 900.00. The monthly USD 99.00 is billed later and was not in the paid lines. |

On that baseline, a different idempotency key after completion still returned capture metadata and did not return the receipt token. A receipt read with the token returned 200. A missing or wrong token returned 404. That metadata response was not an ownership check. The stored rows are left as captured. They are not rewritten.

## Official sources checked 5 November 2026

- PayPal Create order: https://developer.paypal.com/api/orders/v2/orders-create
- PayPal Capture payment for order: https://developer.paypal.com/api/orders/v2/orders-capture
- PayPal idempotency (`PayPal-Request-Id`): https://developer.paypal.com/api/rest/reference/idempotency and https://developer.paypal.com/api/make-api-requests
- Orders v2 flow: https://developer.paypal.com/api/rest/integration/orders-api
- Cloudflare Workers pricing, updated 2 October 2026: https://developers.cloudflare.com/workers/platform/pricing/
- Cloudflare Workers limits, updated 29 October 2026: https://developers.cloudflare.com/workers/platform/limits/
- Durable Objects pricing (SQLite on Workers Free): https://developers.cloudflare.com/durable-objects/platform/pricing/
- Workers KV “How KV works” (eventual consistency; not used for this ledger): https://developers.cloudflare.com/kv/concepts/how-kv-works/

Workers Free includes 100,000 requests a day and 10 ms of CPU time per worker invocation. Past the daily request limit, a route can fail open (the Worker is skipped) or fail closed (error 1027). The route must be fail closed. SQLite Durable Objects on the Free plan include 100,000 requests a day, 5 million row reads a day, 100,000 row writes a day, and 5 GB. Past a free Durable Object limit, that operation fails. It does not add a charge. This repository does not upgrade the plan.

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

Those amounts match this catalog’s math. Matching arithmetic is not proof this worker was called.

A real sandbox test of this worker still has to happen before any live cutover. Mocked tests do not capture a sandbox payment and do not send email.

## Transitional risk

Until cutover, a buyer’s browser still decides the PayPal amount. `Object.freeze` on the page catalog only blocks a simple assignment. It is not a security control. The thanks-page text is what that browser saved. It is not the server receipt. The `/receipt/` page stays unavailable while `PAYPAL_ORDER_API` is empty, even if the address contains an amount.

Do not describe checkout as server-validated while `PAYPAL_ORDER_API` is empty.

## Owner decisions still required

Do not do these until Cassandra approves them. This pull request does not.

1. Confirm the Workers Free plan. Do not enable Workers Paid.
2. Apply the SQLite Durable Object migration for `OrderLedger`. Do not create a KV namespace for this ledger.
3. Choose the worker hostname. Production and preview must not share a half-configured URL.
4. Set the route to fail closed so a free-quota 1027 does not skip the worker.
5. Finance supplies the REST app out of band. Sandbox credentials stay in the sandbox worker. A live REST app does not exist in the dashboard record Finance checked. Do not point the live website at sandbox credentials, and do not paste either secret into git, chat, or the page.
6. The PayPal JavaScript button client id on the page and the server OAuth client id must be the same REST app. The live page already has a live client id. A sandbox server app will not match it.
7. After a sandbox preview works, approve merge and deployment. Then, in a separate reviewed change, set `PAYPAL_ORDER_API` on checkout and the same `https` origin in `receipt/index.html`. Leave both empty until then.

## Secret storage

Use Cloudflare Worker secrets only. Never commit them and never send them to the browser.

- `PAYPAL_CLIENT_ID`
- `PAYPAL_CLIENT_SECRET`
- `ORDER_BINDING_SECRET` (at least 32 characters, not the PayPal secret)

Dashboard variables, not secrets:

- `PAYPAL_API_BASE` exactly `https://api-m.sandbox.paypal.com` or exactly `https://api-m.paypal.com`
- `ALLOWED_ORIGINS` comma-separated. The first sandbox deploy must use a preview origin, not `https://desanya.tech`, until a later cutover.

Unset, wrong, or short values make the worker return `503 not_configured`. It does not create an order. A storage error before PayPal returns `503 storage_unavailable` and does not call PayPal. A storage error after PayPal has captured returns `502 capture_not_stored`. Checkout does not start a browser-priced order. A retry uses the same PayPal request id.

## Free-tier limits to watch before any later cutover

- 100,000 worker requests a day, then error 1027 if the route is fail closed.
- 10 ms CPU on the outer worker. The outer worker forwards to the Durable Object. Confirm a real invocation before cutover. This pull request does not have that measurement.
- Durable Object Free limits above. A studio receipt volume fits. When a limit is hit, the operation fails closed.
