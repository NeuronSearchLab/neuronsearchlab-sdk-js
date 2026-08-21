# @neuronsearchlab/sdk

Official TypeScript SDK for the NeuronSearchLab Core API. It exposes a single `NeuronSDK` class for recommendation systems work: track events, sync catalogue items, request personalized recommendations, run product/content search, and capture request attribution for ranking quality analysis.

## Installation

```bash
npm install @neuronsearchlab/sdk
```

## Quick start

```ts
import {NeuronSDK, configureLogger} from "@neuronsearchlab/sdk";

configureLogger({level: "INFO"});

const sdk = new NeuronSDK({
  baseUrl: "https://api.neuronsearchlab.com/v1",
  accessToken: process.env.NEURON_API_TOKEN!,
  // Optional batching controls (defaults shown)
  collateWindowSeconds: 3,
  maxBatchSize: 200,
  maxBufferedEvents: 5000,
});

const item = await sdk.upsertItem<{id: number}>({
  name: "Premier League Highlights",
  description: "Matchday recap",
  metadata: {league: "EPL"},
});
const itemId = item.id; // NSL-generated integer; persist this mapping

await sdk.trackEvent({
  eventId: 42, // from dashboard Event configuration
  userId: "42",
  itemId,
  contextId: 101,
  metadata: {action: "view"},
});

await sdk.patchItem({itemId, name: "Premier League Highlights v2"});
await sdk.deleteItems({itemId});

const recs = await sdk.getRecommendations({
  userId: "42",
  contextId: 101,
  limit: 5,
});

const results = await sdk.search({
  query: "latest football highlights",
  userId: "42",
  contextId: 101,
  limit: 5,
  filter: ["category:sports"],
});
```

## Reference tables

### Configuration

| Key | Default | Description |
| --- | --- | --- |
| `collateWindowSeconds` | `3` | Buffer events for this many seconds before flushing. |
| `maxBatchSize` | `200` | Flush immediately once the buffer reaches this size. |
| `maxBufferedEvents` | `5000` | Maximum number of buffered events; oldest are dropped (with a warning) beyond this limit. |
| `maxEventRetries` | `5` | Event send retries (with exponential backoff) after network failures. |
| `disableArrayBatching` | `false` | Force single-event sends (used automatically if the server rejects array payloads). |

### Resources

| Resource | Link |
| --- | --- |
| Docs hub | https://docs.neuronsearchlab.com |
| API reference | https://docs.neuronsearchlab.com/api |
| Quick start | https://docs.neuronsearchlab.com/get-started |
| Recommendation systems reading path | https://www.neuronsearchlab.com/blog/recommendation-systems |
| Native Swift SDK | https://github.com/NeuronSearchLab/neuronsearchlab-swift-sdk |

### Methods

| Method | Required fields | Notes |
| --- | --- | --- |
| `trackEvent(data)` | `eventId` (integer), `userId` (string or number), `itemId` (integer) | IDs must be the values created/returned by NSL. Optional `contextId` is also an integer. |
| `upsertItem(data)` | `name`, `description`, `metadata` | Creates catalogue entries and returns an NSL-generated integer `id`. |
| `patchItem(data)` | `itemId` (integer) plus one or more update fields | Updates an existing catalogue entry via `/v1/items/{item_id}`. |
| `deleteItems(items)` | `itemId` (integer) | Deletes one or more NSL-generated item IDs. |
| `getRecommendations(options)` | `userId` (string or number) | Optional: `contextId` (integer), `limit` (number). |
| `search(options)` | `query` (string) | Posts query-driven retrieval requests to the Core API `/v1/search` AWS API Gateway endpoint. Optional: `userId`, `contextId`, `limit`, `filter`, `scope`, and hybrid search tuning fields. |

### Event batching behavior

- Events are buffered in-memory with a `client_ts` timestamp when `trackEvent` is called.
- For retry-safe ingestion, pass a stable `deduplicationId` generated and persisted by your application. The aliases `deduplication_id`, `idempotencyKey`, `idempotency_key`, `messageId`, and `message_id` are accepted and normalized to `deduplication_id`. The SDK intentionally does not auto-generate this value because a process retry must reuse the same key.
- Flush triggers: collate window elapses, buffer reaches `maxBatchSize`, or lifecycle events (`beforeunload`, `pagehide`, `visibilitychange` when hidden). You can also call `sdk.flushEvents()` to flush immediately.
- On transient failures, buffered events are re-queued and retried with exponential backoff (bounded by `maxEventRetries`). If the buffer exceeds `maxBufferedEvents`, the oldest events are dropped with a warning.
- If the server rejects array payloads, the SDK automatically falls back to single-event sends for subsequent flushes (or set `disableArrayBatching: true` to force this upfront).

### Search

`search()` uses the public Core API data plane (`POST /v1/search`) and should be called from your backend with the same OAuth token flow as recommendations. It does not call the console Platform API.

```ts
const results = await sdk.search({
  query: "waterproof trail shoes",
  userId: "user-123",
  contextId: 101,
  limit: 10,
  filter: ["category:footwear"],
  queryRetrievalEnabled: true,
  fusionMethod: "rrf",
});
```

The response uses the same list envelope and recommendation item shape as `getRecommendations()`, with `url: "/v1/search"` and `query` included for attribution. The SDK captures the returned `request_id` so subsequent `trackEvent()` calls can be linked to the search result set.

## Development

```bash
npm install
npm run build
```

## License

MIT
