---
"@neuronsearchlab/sdk": minor
---

`getRecommendationSets({ groupId })` loads every rail of a context group in one request. Each rail comes back under its context key, in the group's order, and the group's rules apply. `limit` sizes every rail; `sets` is optional and adjusts a group rail (by `contextId`) or adds another context.
