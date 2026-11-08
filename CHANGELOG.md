# @neuronsearchlab/sdk

## 2.4.0

### Minor Changes

- f412b92: Add visitor identity: every instance has an anonymous id (`anonymousId` config, `getAnonymousId()`) that events and recommendation calls use as `user_id` when you leave it out, and always send as `anonymous_id`. `identify(userId)` links the anonymous history to the user through `POST /v1/identify` and makes them the default; `reset()` starts a fresh anonymous visitor and session. Browsers can opt in to `persistence: "localStorage"` (the nsl-embed keys `nsl_aid` / `nsl_sid`), gated by `consent` / `setConsent()`. SDK-managed session ids now rotate after 30 minutes without an event (`sessionTimeoutMs`). Events no longer require `userId`. Every event now also sends `platform` (`web` in browsers, `server` elsewhere, or the new `platform` config) and `client` (`js-sdk/<version>`, baked in at build time) in its body.

## 2.3.0

### Minor Changes

- 29ed3a3: Add `getRecommendationSets()`: every recommendation rail of a page in one request (`POST /v1/recommendations/batch`). Each set keeps its own `request_id` for event attribution and is billed on its own; calls with more than 8 sets are split into parallel batches, and a `requestId` makes retries idempotent.

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
