---
"@neuronsearchlab/sdk": minor
---

Add `getRecommendationSets()`: every recommendation rail of a page in one request (`POST /v1/recommendations/batch`). Each set keeps its own `request_id` for event attribution and is billed on its own; calls with more than 8 sets are split into parallel batches, and a `requestId` makes retries idempotent.
