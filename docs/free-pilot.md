# ALLACON OS 0.1 — free-only execution gate

**Hard constraint: 0 UAH total.** No paid API, trial requiring payment method, subscription, top-up, or billable deployment.

## Allowed path
- Gemini free-tier API **only if** currently eligible for this account, region and model, with no billing enabled.
- DeepSeek free access **only if** a verified free API entitlement exists. Free chat website access does not imply free API access.
- Otherwise use a manual handoff for DeepSeek; do not silently substitute a paid API or claim automated integration.
- ChatGPT coordinates drafts and approvals. Do not claim background access to ChatGPT consumer UI through API.

## Before any provider request
- Confirm no billing account/payment method required and free quota available.
- If not confirmed, stop the provider step and mark it BLOCKED_FREE_ACCESS.
- Log cost as zero only for verified free-tier calls, not estimates.
- No production writes or publication.

## Pilot: 5 products
2456618880 RedHead Tech Hoodie
2456642570 Huntech Micro Lite
2456655823 Prime Series Realtree
2456826097 Cabela's Canada
2457760590 RedHead Fleece Quarter-Zip

Output: product ID, source title and facts, SEO draft, sales draft, related products verified against catalog, owner approval status. Prioritize conversions, do not audit fabrics or invent product claims.

## Status
Policy and pilot list documented. No API integration or provider account access confirmed. This file is not a working automation.
