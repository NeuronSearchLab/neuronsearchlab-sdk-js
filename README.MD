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
  // Static tokens remain supported.
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

## Server authentication

Configure exactly one authentication method: `accessToken`, `tokenProvider`,
or `oauthClientCredentials`.

For long-running server integrations, client credentials are the recommended
path. The SDK acquires short-lived tokens, caches them in memory, refreshes them
before expiry, coalesces concurrent refreshes into one token request, and on a
401 performs exactly one forced refresh and one retry.

```ts
const sdk = new NeuronSDK({
  baseUrl: "https://api.neuronsearchlab.com/v1",
  oauthClientCredentials: {
    clientId: process.env.NSL_CLIENT_ID!,
    clientSecret: process.env.NSL_CLIENT_SECRET!,
    // These are the defaults and may be omitted for the hosted NSL issuer.
    tokenUrl: "https://auth.neuronsearchlab.com/oauth2/token",
    scope: ["neuronsearchlab-api/read", "neuronsearchlab-api/write"],
  },
});
```

> **Server-only:** OAuth client credentials contain a client secret. Never use
> this configuration in browser, mobile, desktop, or other user-distributed
> code. The SDK rejects it in browser runtimes. Keep credentials in a server
> secret manager and expose only your own authenticated backend endpoint to
> untrusted clients.

If your application already owns token acquisition, provide an async source.
The SDK caches the result; return expiry information to enable proactive
refresh. A provider receives `forceRefresh: true` after a 401 and should bypass
any cache it owns.

```ts
const sdk = new NeuronSDK({
  baseUrl: "https://api.neuronsearchlab.com/v1",
  tokenProvider: async ({forceRefresh}) => {
    const token = await auth.getAccessToken({forceRefresh});
    return {
      accessToken: token.value,
      expiresAt: token.expiresAt, // Date or Unix epoch milliseconds
    };
  },
});
```

Plain string provider results are cached until a 401. Static `accessToken`
values cannot be refreshed automatically; use `sdk.setAccessToken()` to rotate
one explicitly.

## Reference tables

### Configuration

| Key | Default | Description |
| --- | --- | --- |
| `baseUrl` | Required | Core API base URL. `/v1` is appended when no version suffix is present. |
| `accessToken` | — | Static bearer token. Configure instead of the two dynamic auth options. |
| `tokenProvider` | — | Async token source. May return a string or `{ accessToken, expiresAt?, expiresInSeconds? }`. |
| `oauthClientCredentials` | — | Server-only OAuth client credentials with optional `tokenUrl`, `scope`, `audience`, and additional issuer parameters. |
| `tokenExpirySkewMs` | `60000` | Refresh dynamic tokens before expiry; capped at half the issued token lifetime. |
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
