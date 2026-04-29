# @neuronsearchlab/sdk

Tiny TypeScript client and structured logger for the NeuronSearchLab API. It exposes a single `NeuronSDK` class (track events, upsert items, request recommendations) plus `configureLogger` for opt-in diagnostic output.

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

const itemId = "itm_3187";

await sdk.trackEvent({
  type: "view",
  userId: "42",
  itemId,
  metadata: {action: "view"},
});

await sdk.upsertItem({
  id: itemId,
  name: "Premier League Highlights",
  description: "Matchday recap",
  metadata: {league: "EPL"},
});

await sdk.patchItem({itemId, name: "Premier League Highlights v2"});
await sdk.deleteItems({itemId});

const recs = await sdk.getRecommendations({
  userId: "42",
  contextId: "ctx_homepage",
  limit: 5,
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

### Methods

| Method | Required fields | Notes |
| --- | --- | --- |
| `trackEvent(data)` | `type`, `userId` (string or number), `itemId` (`itm_...` string), `metadata` (object) | Buffers events in order and batches to the `/v1/events` endpoint (single or array payloads). |
| `upsertItem(data)` | `id` or `itemId` (`itm_...` string), `name`, `description`, `metadata` | Creates catalogue entries via `/v1/items`. |
| `patchItem(data)` | `itemId` (`itm_...` string) plus one or more update fields | Updates an existing catalogue entry via `/v1/items/{item_id}`. |
| `deleteItems(items)` | `itemId` (`itm_...` string) | Accepts a single `{itemId}` object or an array and deletes each item through `/v1/items/{item_id}`. |
| `getRecommendations(options)` | `userId` (string or number) | Optional: `contextId` (string), `limit` (number). |

### Event batching behavior

- Events are buffered in-memory with a `client_ts` timestamp when `trackEvent` is called.
- Flush triggers: collate window elapses, buffer reaches `maxBatchSize`, or lifecycle events (`beforeunload`, `pagehide`, `visibilitychange` when hidden). You can also call `sdk.flushEvents()` to flush immediately.
- On transient failures, buffered events are re-queued and retried with exponential backoff (bounded by `maxEventRetries`). If the buffer exceeds `maxBufferedEvents`, the oldest events are dropped with a warning.
- If the server rejects array payloads, the SDK automatically falls back to single-event sends for subsequent flushes (or set `disableArrayBatching: true` to force this upfront).

## Development

```bash
npm install
npm run build
```

## License

MIT
