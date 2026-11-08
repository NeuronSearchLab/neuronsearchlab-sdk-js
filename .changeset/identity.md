---
"@neuronsearchlab/sdk": minor
---

Add visitor identity: every instance has an anonymous id (`anonymousId` config, `getAnonymousId()`) that events and recommendation calls use as `user_id` when you leave it out, and always send as `anonymous_id`. `identify(userId)` links the anonymous history to the user through `POST /v1/identify` and makes them the default; `reset()` starts a fresh anonymous visitor and session. Browsers can opt in to `persistence: "localStorage"` (the nsl-embed keys `nsl_aid` / `nsl_sid`), gated by `consent` / `setConsent()`. SDK-managed session ids now rotate after 30 minutes without an event (`sessionTimeoutMs`). Events no longer require `userId`.
