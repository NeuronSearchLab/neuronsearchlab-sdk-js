# @neuronsearchlab/sdk

## 2.2.0

### Minor Changes

- d399cfc: Send searches as events. `trackSearch({ userId, query, resultItemIds })` (or `trackEvent` with a `query` and no `itemId`) records a search your own engine ran; it steers the user's recommendations by the weight of your Search event. `search()` accepts `resultItemIds` to record your engine's results and get complementary recommendations back, and recommendation responses expose `search_intent` when searches steered them.

## 2.1.0

### Minor Changes

- be3210a: Add production-grade server authentication with async token providers, OAuth client-credentials acquisition, in-memory expiry caching, singleflight refreshes, and one refresh-and-retry after a 401 while retaining static access-token compatibility. Add caller-owned event deduplication keys and normalize supported aliases to `deduplication_id` for retry-safe ingestion.

## 2.0.0

### Major Changes

- 1f30ab1: Require dashboard-created integer event and context IDs, require NSL-generated integer item IDs, and return numeric IDs from item and recommendation APIs.

## 1.20.0

### Minor Changes

- Add `search()` for query-driven Core API search requests through the AWS API Gateway `/v1/search` endpoint.

## 1.19.1

### Patch Changes

- Preserve caller-provided item IDs and allow raw string or number identifiers across events and item APIs.

## 1.19.0

### Minor Changes

- 4ec4d8a: Update the client for the v1 public API contract with prefixed item identifiers, typed event payloads, cursor-aware recommendation parameters, and item update/delete resource routes.
