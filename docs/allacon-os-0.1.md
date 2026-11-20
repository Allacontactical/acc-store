# ALLACON OS 0.1 — integration plan (draft, no production changes)

Goal: increase ACC organic search visits, inquiries, and orders. No speculative product properties, no unnecessary material audits, no rewriting already-effective listings.

## Agents
1. DeepSeek: SEO title, keyword clusters, search intent, short recommendations.
2. Gemini: Ukrainian sales copy, benefits based exclusively on seller-supplied facts, CTA, related-product suggestions only from actual ACC catalog.
3. ChatGPT: orchestrator, deduplication, priority ranking, final QA and owner approval. Russian translation only when needed.

## Pipeline
- Import existing product ID, seller text, current title, URL, availability, price and catalog relations.
- Prioritize by search opportunity and sales potential; skip effective cards unless measurable reason.
- DeepSeek produces strict JSON: product_id, title_ua, primary_query, secondary_queries, rationale.
- Gemini receives original facts plus DeepSeek SEO suggestions; produces JSON: product_id, description_ua, cta, related_product_ids, rationale.
- Coordinator checks that all product claims are supported by input, links are valid, no duplicate, no invented sizes/stock/prices; prepares diff.
- Save drafts and review statuses only. Owner approval required before any public write.
- On approval, publish through the existing authorized ACC publishing flow only after validation; log status and rollback info.
- Measure organic visits, product inquiries and orders by product ID. Do not treat number of rewritten cards as KPI.

## Integration design
- Existing Cloudflare Worker can coordinate two outbound API calls, provided API access is configured and verified.
- Secrets must be stored in Cloudflare Worker secrets, never in GitHub or chat.
- Suggested endpoints: POST /os/jobs (draft), GET /os/jobs/:id, POST /os/jobs/:id/approve, POST /os/jobs/:id/publish. These are proposed, NOT implemented.
- Add idempotency by product_id+source_revision; retry transient failures, log model/provider response without credentials.
- No automatic publication; production untouched until owner approval and end-to-end test.

## Status
Design only. DeepSeek/Gemini API access, Worker route and ACC publish adapter not yet connected or tested.
