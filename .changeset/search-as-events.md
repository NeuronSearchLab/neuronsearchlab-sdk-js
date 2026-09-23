---
"@neuronsearchlab/sdk": minor
---

Send searches as events. `trackSearch({ userId, query, resultItemIds })` (or `trackEvent` with a `query` and no `itemId`) records a search your own engine ran; it steers the user's recommendations by the weight of your Search event. `search()` accepts `resultItemIds` to record your engine's results and get complementary recommendations back, and recommendation responses expose `search_intent` when searches steered them.
