# ALLACON OS 0.1 — safe integration configuration

This is a non-production integration scaffold. No API calls are made until credentials are provisioned and an authorized deploy is approved.

## Required Worker secrets
- DEEPSEEK_API_KEY
- GEMINI_API_KEY

Never commit API keys to GitHub, product data, logs or chat.

## Agent chain
1. Input: product_id, original seller description, title, catalog data, performance indicators.
2. DeepSeek API: https://api.deepseek.com/chat/completions ; model deepseek-flash. JSON output: SEO title, primary query, supporting queries.
3. Gemini Developer API: choose an available free-tier text model; use the current documented model endpoint. JSON output: Ukrainian conversion copy, CTA, catalog-verified related product IDs.
4. Coordinator: reject unsupported product claims, missing links, invalid IDs; present draft and comparison.
5. Publication disabled until explicit owner approval; do not automatically edit production files.

## Test checklist
- Credentials stored as Worker secrets (not in repo).
- Mock-only dry run without external API credentials.
- Five approved product IDs processed in draft mode.
- Confirm no hallucinated product facts and no external publishing.
- Record API spend and successful/failed requests.
- Owner approves real publishing only after viewing the final result.

## Deployment status
Design/scaffold only. No live API credentials or connections verified; no Worker deployment performed.
