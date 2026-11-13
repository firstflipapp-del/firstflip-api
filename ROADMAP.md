# Roadmap

What the FirstFlip API will cover. Each product reuses the same foundation (keys, modes, idempotency,
errors, signed webhooks), so an integration built today extends rather than changes. Nothing below is a
date commitment; every product that moves money ships only after its own security and money review.

| Product | What it does for your customers | Status |
|---|---|---|
| **Charges** | Accept crypto, settle to your bank | **Beta, test mode** |
| **Hosted checkout & payment links** | A shareable pay link or redirect page per charge; no-code links from the dashboard | **Beta, test mode** (API); dashboard links planned |
| **Invoices** | Itemised invoices, emailed with a pay link | Planned (exists in the FirstFlip app) |
| **Crypto POS / pre-orders** | In-store and pre-order payments from a device | Planned (exists in the app) |
| **Crypto sell** | Customers sell crypto and receive naira; you set your margin on top | Planned |
| **Gift card sell** | Customers sell gift cards for naira; you set your margin | Planned |
| **Gift card buy** | Sell gift cards to your customers | Planned; requires a **prefunded business balance** (suppliers are paid upfront) |
| **Virtual cards** | Issue USD virtual cards to your customers | **Test mode, shipping** (`/v1/cards`: create, fund, withdraw, freeze, unfreeze, close, spend limits, simulate an authorization, ledger). Sandbox only — no PAN, no issuer, nothing settles. **Live cards remain planned**: they need an issuer rail, encrypted PAN handling and a 3-D Secure step-up, none of which exists on today's surface |
| **NGN virtual accounts** | A dedicated naira account number per customer, for pay-ins | Planned |
| **Bill payments with crypto** | Airtime, data, electricity and TV paid in crypto | Planned |
| **Identity (KYC) as a service** | Verify your customers' identity through FirstFlip | Planned; billed per verification from a prefunded balance |
| **Payouts & refunds** | Send settlements and refunds by API | Planned; heaviest security review |
| **SDKs** | `@firstflip/node` (beta, in `sdks/node`); a browser "Pay with crypto" button, React Native | Node beta; others planned |
| **Plugins** | Shopify, WooCommerce | Planned |

## Prefunded products

Some products cost FirstFlip money before your customer pays (for example, gift card and card suppliers
are paid upfront, and identity checks are billed per check). These will draw from a **business balance**
you top up in advance. Every draw will be itemised in the API and dashboard, and a request that would
overdraw your balance will fail with a clear error instead of going through.
