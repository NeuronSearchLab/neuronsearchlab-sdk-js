// src/index.ts

import {logger} from "./logger";

export {configureLogger, logger} from "./logger";
export type {
  LogLevel,
  LoggerConfig,
  StructuredLogEntry,
  LoggerTransport,
} from "./logger";

export type SDKConfig = {
  baseUrl: string; // e.g. https://api.neuronsearchlab.com/v1
  accessToken: string; // Bearer token
  timeoutMs?: number; // default 10_000
  maxRetries?: number; // retry on 429/5xx/timeouts, default 2
  fetchImpl?: typeof fetch; // custom fetch (e.g., undici/node-fetch for older Node)
  collateWindowSeconds?: number; // buffer events for this many seconds before flushing; default 3
  maxBatchSize?: number; // flush immediately once this many events are buffered; default 200
  maxBufferedEvents?: number; // drop oldest events past this limit; default 5000
  maxEventRetries?: number; // max send retries for buffered events after network failure; default 5
  disableArrayBatching?: boolean; // force single-event sends (used after server rejects arrays)

  /**
   * ✅ NEW: request_id propagation
   * If true (default), the SDK will remember the latest request_id returned by
   * /recommendations and automatically attach it to subsequent trackEvent calls
   * (unless you explicitly pass requestId/request_id in the event payload).
   */
  propagateRecommendationRequestId?: boolean;

  /**
   * ✅ NEW: session_id support
   * If provided, SDK uses this session id for all events unless overridden per-event.
   * If not provided, SDK auto-creates a session id (stable for the lifetime of the SDK instance).
   *
   * You can override later via sdk.setSessionId("...") or per-event via payload sessionId/session_id.
   */
  sessionId?: string | null;

  /**
   * If true (default), SDK auto-creates a sessionId when none is provided.
   * Set false if you *never* want the SDK to attach session_id automatically.
   */
  autoSessionId?: boolean;
};

export type APIErrorBody = {
  error?:
    | string
    | {
        type?: string;
        code?: string;
        message?: string;
        details?: unknown;
        [k: string]: unknown;
      };
  message?: string;
  code?: string | number;
  details?: unknown;
  [k: string]: unknown;
};

export class SDKHttpError extends Error {
  public status: number;
  public statusText: string;
  public body?: APIErrorBody | string;

  constructor(
    msg: string,
    opts: {status: number; statusText: string; body?: APIErrorBody | string}
  ) {
    super(msg);
    this.name = "SDKHttpError";
    this.status = opts.status;
    this.statusText = opts.statusText;
    this.body = opts.body;
  }
}

export class SDKTimeoutError extends Error {
  constructor(public timeoutMs: number) {
    super(`Request timed out after ${timeoutMs} ms`);
    this.name = "SDKTimeoutError";
  }
}

// -------- Domain payloads --------

export type TrackEventPayload = {
  type?: string;
  eventType?: string;
  event_type?: string;
  eventId?: number | string;
  event_id?: number | string;
  userId?: number | string;
  user_id?: number | string;
  itemId?: string;
  item_id?: string;
  occurredAt?: number;
  occurred_at?: number;

  requestId?: string;
  request_id?: string;
  sessionId?: string;
  session_id?: string;

  [k: string]: unknown;
};

export type ItemUpsertPayload = {
  id?: string;
  itemId?: string;
  item_id?: string;
  name?: string;
  description?: string;
  metadata?: Record<string, any>;
  [k: string]: unknown;
};

export type RecommendationOptions = {
  userId: number | string;
  contextId?: string;
  contextKey?: string;
  scope?: Record<string, unknown>;
  limit?: number;
  startingAfter?: string;
  starting_after?: string;
};

export type AutoRecommendationsOptions = {
  userId: number | string;
  contextId?: string; // optional: apply the same context filters while filling auto sections
  contextKey?: string;
  scope?: Record<string, unknown>;
  limit?: number; // quantity per section
  cursor?: string; // pass the last next_cursor returned by the API
  windowDays?: number; // optional override; API may choose to honor cursor continuity
  candidateLimit?: number; // optional tuning
  servedCap?: number; // optional tuning
};

export type DeleteItemInput = {
  itemId?: string;
  item_id?: string;
  id?: string;
};

export type DeleteItemsResponse = {
  message: string;
  object?: "deleted_item" | "list" | string;
  id?: string;
  itemId?: string;
  itemIds: string[];
  deletedCount?: number;
  data?: unknown[];
  processing_time_ms?: number;
};

export type PatchItemInput = {
  itemId?: string;
  item_id?: string;
  id?: string;
  active?: boolean;
  [k: string]: unknown;
};

export type PatchItemResponse = {
  id: string;
  object?: "item" | string;
  message?: string;
  active?: boolean;
  updated_at?: number;
  processing_time_ms?: number;
};

export type RecommendationResource = {
  id?: string;
  object?: "recommendation" | string;
  item_id?: string;
  item?: {
    id?: string;
    object?: "item" | string;
    name?: string;
    description?: string;
    metadata?: Record<string, any>;
    score?: number;
    [k: string]: unknown;
  };
  entity_id?: string;
  name?: string;
  description?: string;
  score?: number;
  rank?: number;
  metadata?: Record<string, any>;
  embedding?: number[];
  items?: RecommendationResource[];
  [k: string]: unknown;
};

// Updated response type to match API (incl. request_id)
export type RecommendationsResponse = {
  message?: string;

  // ✅ NEW: correlation id from API
  request_id?: string;

  embedding_info?: {
    source: string;
    used_default: boolean;
    default_reason?: string | null;
    dimension: number;
    expected_dimension: number;
    averaged_interactions?: number;
  };
  upserted_embedding_row?: {
    tenant_id: string;
    entity_id: string;
    name: string;
    description: string;
    entity_type: string;
    created_at: string;
    last_modified: string;
    embedding: string;
  };
  object?: "list" | string;
  data?: RecommendationResource[];
  recommendations: RecommendationResource[];
  quantity?: number;
  limit?: number;
  has_more?: boolean;
  excluded_viewed_items?: {
    value: number | null;
    unit: string;
    interval: string | null;
  } | null;
  processing_time_ms?: number;

  // mode=auto support (backwards compatible)
  mode?: "auto" | "single" | string;
  section?: {
    section_id: string;
    title: string;
    reason: Record<string, any>;
  } | null;
  next_cursor?: string | null;
  done?: boolean;
};

// Legacy type for backwards compatibility
export type Recommendation = {
  itemId: number | string;
  score?: number;
  reason?: string;
  [k: string]: unknown;
};

type BufferedEvent<T> = {
  payload: T;
  resolve: (value: any) => void;
  reject: (err: any) => void;
  retries: number;
  enqueueTime: number;
};

const normalizeOptionalString = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s ? s : null;
};

const normalizeApiBaseUrl = (url: string): string => {
  const trimmed = url.replace(/\/+$/, "");
  return /\/v\d+$/i.test(trimmed) ? trimmed : `${trimmed}/v1`;
};

const normalizeNonEmptyString = (v: unknown): string | null => {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const s = String(v).trim();
  return s ? s : null;
};

const isValidItemId = (v: unknown): v is string => {
  return typeof v === "string" && /^itm_[A-Za-z0-9][A-Za-z0-9_-]*$/.test(v);
};

const getItemId = (input: Record<string, unknown> | null | undefined) => {
  return normalizeNonEmptyString(input?.id ?? input?.item_id ?? input?.itemId);
};

const normalizeItemPayload = (input: ItemUpsertPayload): Record<string, unknown> => {
  if (!input || typeof input !== "object") {
    throw new Error("item payload must be an object");
  }

  const id = getItemId(input);
  if (id && !isValidItemId(id)) {
    throw new Error("item id must be a prefixed string like itm_abc123");
  }

  const {itemId: _itemId, item_id: _item_id, ...rest} = input;
  return id ? {...rest, id} : rest;
};

const normalizeEventPayload = (data: TrackEventPayload): Record<string, unknown> => {
  if (!data || typeof data !== "object") {
    throw new Error("event payload must be an object");
  }

  const userId = normalizeNonEmptyString(data.user_id ?? data.userId);
  const itemId = normalizeNonEmptyString(data.item_id ?? data.itemId);
  const type = normalizeNonEmptyString(
    data.type ?? data.event_type ?? data.eventType ?? data.event_id ?? data.eventId
  );

  if (!userId || !itemId || !type) {
    throw new Error("type, userId, and itemId are required");
  }

  if (!isValidItemId(itemId)) {
    throw new Error("itemId must be a prefixed string like itm_abc123");
  }

  const occurredAt =
    typeof data.occurred_at === "number"
      ? data.occurred_at
      : typeof data.occurredAt === "number"
      ? data.occurredAt
      : Math.floor(Date.now() / 1000);

  return {
    ...data,
    user_id: userId,
    item_id: itemId,
    type,
    occurred_at: occurredAt,
  };
};

const generateSessionId = (): string => {
  // Prefer Web Crypto UUID if available (browser + modern runtimes)
  try {
    const g: any = globalThis as any;
    if (g?.crypto?.randomUUID && typeof g.crypto.randomUUID === "function") {
      return g.crypto.randomUUID();
    }
  } catch {}

  // Node crypto fallback
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require("crypto");
    if (nodeCrypto?.randomUUID && typeof nodeCrypto.randomUUID === "function") {
      return nodeCrypto.randomUUID();
    }
    if (nodeCrypto?.randomBytes) {
      return `sess_${nodeCrypto.randomBytes(16).toString("hex")}`;
    }
  } catch {}

  // Last resort
  return `sess_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2)}`;
};

export class NeuronSDK {
  private baseUrl: string;
  private accessToken: string;
  private timeoutMs: number;
  private maxRetries: number;
  private fetchImpl: typeof fetch;
  private collateWindowMs: number;
  private maxBatchSize: number;
  private maxBufferedEvents: number;
  private maxEventRetries: number;
  private disableArrayBatching: boolean;
  private eventBuffer: BufferedEvent<any>[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private isFlushing = false;
  private pendingFlushPromise: Promise<void> | null = null;
  private flushRetryCount = 0;
  private lifecycleListenersRegistered = false;
  private arrayBatchingRejected = false;

  // ✅ request_id propagation state
  private propagateRecommendationRequestId: boolean;
  private lastRecommendationRequestId: string | null = null;

  // ✅ session_id state
  private autoSessionId: boolean;
  private sessionId: string | null = null;

  constructor(config: SDKConfig) {
    if (!config.baseUrl || !config.accessToken) {
      throw new Error("baseUrl and accessToken are required");
    }
    this.baseUrl = normalizeApiBaseUrl(config.baseUrl);
    this.accessToken = config.accessToken;
    this.timeoutMs = config.timeoutMs ?? 10_000;
    this.maxRetries = config.maxRetries ?? 2;
    this.fetchImpl = config.fetchImpl ?? (globalThis.fetch as typeof fetch);
    this.collateWindowMs = (config.collateWindowSeconds ?? 3) * 1000;
    this.maxBatchSize = config.maxBatchSize ?? 200;
    this.maxBufferedEvents = config.maxBufferedEvents ?? 5000;
    this.maxEventRetries = config.maxEventRetries ?? 5;
    this.disableArrayBatching = Boolean(config.disableArrayBatching);

    this.propagateRecommendationRequestId =
      config.propagateRecommendationRequestId ?? true;

    // ✅ session config
    this.autoSessionId = config.autoSessionId ?? true;
    this.sessionId = normalizeOptionalString(config.sessionId);

    if (this.autoSessionId && !this.sessionId) {
      this.sessionId = generateSessionId();
    }

    if (!this.fetchImpl) {
      throw new Error(
        "fetch is not available in this environment. Provide config.fetchImpl (e.g., undici or node-fetch)."
      );
    }

    this.registerLifecycleFlush();
  }

  private registerLifecycleFlush() {
    if (this.lifecycleListenersRegistered) return;

    if (
      typeof window !== "undefined" &&
      typeof window.addEventListener === "function"
    ) {
      const handler = () => {
        void this.flushEvents({useBeacon: true});
      };

      window.addEventListener("beforeunload", handler);
      window.addEventListener("pagehide", handler);
      window.addEventListener("visibilitychange", () => {
        if (
          typeof document !== "undefined" &&
          document.visibilityState === "hidden"
        ) {
          handler();
        }
      });
      this.lifecycleListenersRegistered = true;
    }
  }

  public setAccessToken(token: string) {
    this.accessToken = token;
  }

  public setBaseUrl(url: string) {
    this.baseUrl = normalizeApiBaseUrl(url);
  }

  public setTimeout(ms: number) {
    this.timeoutMs = ms;
  }

  /**
   * ✅ NEW: Let callers manually set/override the current request_id
   * (useful if you want to correlate a whole page session yourself).
   */
  public setRequestId(requestId: string | null) {
    this.lastRecommendationRequestId =
      requestId && requestId.trim() ? requestId.trim() : null;
  }

  /**
   * ✅ NEW: Read the last request_id captured from /recommendations
   */
  public getRequestId(): string | null {
    return this.lastRecommendationRequestId;
  }

  /**
   * ✅ NEW: Manually set/override the current session id
   * - If set to null/blank, and autoSessionId=true, a new session id will be generated.
   * - If autoSessionId=false, session id will remain null and no session_id is attached unless provided per-event.
   */
  public setSessionId(sessionId: string | null) {
    this.sessionId = normalizeOptionalString(sessionId);
    if (this.autoSessionId && !this.sessionId) {
      this.sessionId = generateSessionId();
    }
  }

  /**
   * ✅ NEW: Read the current SDK session id (may be null if autoSessionId=false)
   */
  public getSessionId(): string | null {
    return this.sessionId;
  }

  private getHeaders(extra?: HeadersInit): HeadersInit {
    return {
      "Content-Type": "application/json",
      Authorization: `Bearer ${this.accessToken}`,
      ...(extra ?? {}),
    };
  }

  // Core request with timeout + retry (429/5xx + timeouts)
  private async request<T>(
    pathOrUrl: string,
    init: RequestInit & {retryOn?: number[]} = {}
  ): Promise<T> {
    const method = init.method ?? "GET";
    const isAbs = /^https?:\/\//i.test(pathOrUrl);
    const url = isAbs
      ? pathOrUrl
      : `${this.baseUrl}${pathOrUrl.startsWith("/") ? "" : "/"}${pathOrUrl}`;

    const retryOn = init.retryOn ?? [429, 500, 502, 503, 504];
    let attempt = 0;
    const requestId =
      logger.shouldLog("DEBUG") || logger.isPerformanceLoggingEnabled()
        ? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`
        : undefined;

    while (true) {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
      const startTime = logger.isPerformanceLoggingEnabled() ? Date.now() : 0;

      if (logger.shouldLog("DEBUG")) {
        logger.debug("HTTP request attempt", {
          method,
          url,
          attempt,
          maxRetries: this.maxRetries,
          retryOn,
          requestId,
          requestBody: typeof init.body === "string" ? init.body : undefined,
        });
      }

      try {
        const res = await this.fetchImpl(url, {
          ...init,
          signal: controller.signal,
        });
        clearTimeout(timeout);
        const durationMs = startTime ? Date.now() - startTime : undefined;

        if (res.ok) {
          const text = await res.text();
          if (logger.shouldLog("DEBUG")) {
            logger.debug("HTTP response received", {
              method,
              url,
              attempt,
              status: res.status,
              requestId,
              durationMs,
            });
          }
          if (text && logger.shouldLog("TRACE")) {
            logger.trace("HTTP response payload", {
              method,
              url,
              requestId,
              responseBody: text,
            });
          }
          if (!text) return undefined as unknown as T;
          try {
            return JSON.parse(text) as T;
          } catch {
            return text as unknown as T;
          }
        }

        const raw = await res.text().catch(() => "");
        if (logger.shouldLog("WARN")) {
          logger.warn("HTTP response not OK", {
            method,
            url,
            attempt,
            status: res.status,
            statusText: res.statusText,
            requestId,
            durationMs,
            responseBody: raw,
          });
        }

        let body: APIErrorBody | string | undefined;
        try {
          body = raw ? (JSON.parse(raw) as APIErrorBody) : undefined;
        } catch {
          body = raw;
        }

        if (retryOn.includes(res.status) && attempt < this.maxRetries) {
          attempt++;
          const retryAfter = res.headers.get("retry-after");
          const delay =
            retryAfter && !Number.isNaN(Number(retryAfter))
              ? Number(retryAfter) * 1000
              : this.backoffMs(attempt);

          if (logger.shouldLog("INFO")) {
            logger.info("Retrying request after HTTP status", {
              method,
              url,
              attempt,
              status: res.status,
              delayMs: delay,
              requestId,
            });
          }
          await this.sleep(delay);
          continue;
        }

        const msg = `HTTP ${res.status} ${res.statusText} for ${method} ${url}`;
        throw new SDKHttpError(msg, {
          status: res.status,
          statusText: res.statusText,
          body,
        });
      } catch (err: any) {
        clearTimeout(timeout);

        if (err?.name === "AbortError") {
          if (attempt < this.maxRetries) {
            attempt++;
            if (logger.shouldLog("WARN")) {
              logger.warn("Retrying request after timeout", {
                method,
                url,
                attempt,
                timeoutMs: this.timeoutMs,
                requestId,
              });
            }
            await this.sleep(this.backoffMs(attempt));
            continue;
          }

          logger.error("Request aborted after max retries", {
            method,
            url,
            attempts: attempt,
            timeoutMs: this.timeoutMs,
            requestId,
          });
          throw new SDKTimeoutError(this.timeoutMs);
        }

        if (attempt < this.maxRetries) {
          attempt++;
          if (logger.shouldLog("WARN")) {
            logger.warn("Retrying request after network error", {
              method,
              url,
              attempt,
              error: err?.message,
              requestId,
            });
          }
          await this.sleep(this.backoffMs(attempt));
          continue;
        }

        logger.error("Request failed", {
          method,
          url,
          attempts: attempt,
          error: err?.message,
          requestId,
        });
        throw err;
      }
    }
  }

  private backoffMs(attempt: number) {
    const base = 300 * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 200;
    return base + jitter;
  }

  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }

  private scheduleFlush(delayMs?: number) {
    if (this.flushTimer) {
      if (typeof delayMs === "number") {
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => void this.flushEvents(), delayMs);
      }
      return;
    }
    const waitMs = typeof delayMs === "number" ? delayMs : this.collateWindowMs;
    this.flushTimer = setTimeout(() => void this.flushEvents(), waitMs);
  }

  private trimBufferIfNeeded(incomingCount = 0) {
    const overflow =
      this.eventBuffer.length + incomingCount - this.maxBufferedEvents;
    if (overflow > 0) {
      const dropped = this.eventBuffer.splice(0, overflow);
      if (logger.shouldLog("WARN")) {
        logger.warn("Dropping buffered events due to maxBufferedEvents limit", {
          maxBufferedEvents: this.maxBufferedEvents,
          dropped: overflow,
        });
      }
      dropped.forEach((evt) =>
        evt.reject(
          new Error(
            "Event dropped because the buffer exceeded maxBufferedEvents"
          )
        )
      );
    }
  }

  private enqueueEvent<TResponse>(payload: any): Promise<TResponse> {
    return new Promise<TResponse>((resolve, reject) => {
      this.trimBufferIfNeeded(1);

      this.eventBuffer.push({
        payload,
        resolve,
        reject,
        retries: 0,
        enqueueTime: Date.now(),
      });

      if (this.eventBuffer.length >= this.maxBatchSize) {
        void this.flushEvents();
      } else {
        this.scheduleFlush();
      }
    });
  }

  public async flushEvents(options: {useBeacon?: boolean} = {}): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.isFlushing || this.eventBuffer.length === 0) {
      return this.pendingFlushPromise ?? Promise.resolve();
    }
    this.isFlushing = true;

    const promise = (async () => {
      while (this.eventBuffer.length > 0) {
        const batch = this.eventBuffer.splice(0, this.maxBatchSize);
        try {
          const response = await this.sendBatch(batch, options);
          batch.forEach((entry) => entry.resolve(response));
          this.flushRetryCount = 0;
        } catch (err: any) {
          this.eventBuffer = batch.concat(this.eventBuffer);
          this.trimBufferIfNeeded();
          this.flushRetryCount += 1;
          const willRetry = this.flushRetryCount <= this.maxEventRetries;

          if (logger.shouldLog(willRetry ? "WARN" : "ERROR")) {
            logger[willRetry ? "warn" : "error"](
              willRetry
                ? "Failed to send events, scheduling retry"
                : "Dropping events after max retries",
              {
                attempt: this.flushRetryCount,
                maxEventRetries: this.maxEventRetries,
                error: err?.message,
                bufferedCount: this.eventBuffer.length,
              }
            );
          }

          if (willRetry) {
            this.scheduleFlush(this.backoffMs(this.flushRetryCount));
          } else {
            const dropError = new Error(
              "Max retries reached while sending buffered events"
            );
            batch.forEach((entry) => entry.reject(dropError));
          }
          break;
        }
      }
    })();

    this.pendingFlushPromise = promise.finally(() => {
      this.isFlushing = false;
      this.pendingFlushPromise = null;
    });

    return this.pendingFlushPromise;
  }

  private async sendBatch(
    batch: BufferedEvent<any>[],
    options: {useBeacon?: boolean}
  ): Promise<any> {
    const shouldSendArray =
      batch.length > 1 &&
      !this.disableArrayBatching &&
      !this.arrayBatchingRejected;

    if (shouldSendArray) {
      try {
        return await this.postEvents(
          batch.map((entry) => entry.payload),
          options
        );
      } catch (err: any) {
        if (!this.arrayBatchingRejected && err instanceof SDKHttpError) {
          this.arrayBatchingRejected = true;
          if (logger.shouldLog("WARN")) {
            logger.warn(
              "Array payload rejected, falling back to single-event sends",
              {
                status: err.status,
                statusText: err.statusText,
              }
            );
          }
          return this.sendIndividually(batch, options);
        }
        throw err;
      }
    }

    return this.sendIndividually(batch, options);
  }

  private async sendIndividually(
    batch: BufferedEvent<any>[],
    options: {useBeacon?: boolean}
  ): Promise<any> {
    let lastResponse: any;
    for (const entry of batch) {
      lastResponse = await this.postEvents(entry.payload, options);
    }
    return lastResponse;
  }

  private async postEvents(payload: any, options: {useBeacon?: boolean}) {
    const body = JSON.stringify(payload);
    return this.request("/events", {
      method: "POST",
      headers: this.getHeaders(),
      body,
      keepalive: Boolean(options.useBeacon),
    });
  }

  // ----------------- Public API -----------------

  /**
   * Track an existing event occurrence.
   * POST /v1/events
   */
  public async trackEvent<T = {success: true; id?: number}>(
    data: TrackEventPayload
  ): Promise<T> {
    const normalized = normalizeEventPayload(data);

    // ✅ attach request_id if:
    // - propagation enabled
    // - caller didn't provide one
    // - we have one captured from /recommendations
    const existingRid =
      typeof (data as any).requestId === "string"
        ? (data as any).requestId
        : typeof (data as any).request_id === "string"
        ? (data as any).request_id
        : undefined;

    const ridToAttach =
      !existingRid && this.propagateRecommendationRequestId
        ? this.lastRecommendationRequestId ?? undefined
        : undefined;

    // ✅ session_id: use event-provided value if present, else SDK sessionId (auto-created unless disabled)
    const existingSid =
      typeof (data as any).sessionId === "string"
        ? (data as any).sessionId
        : typeof (data as any).session_id === "string"
        ? (data as any).session_id
        : undefined;

    // If autoSessionId enabled but we don't yet have one (edge: setSessionId(null) with autoSessionId=false toggled later)
    if (this.autoSessionId && !this.sessionId) {
      this.sessionId = generateSessionId();
    }

    const sidToAttach =
      !existingSid && this.sessionId ? this.sessionId : undefined;

    const payload = {
      ...normalized,

      // normalize + attach
      ...(ridToAttach ? {request_id: ridToAttach} : {}),
      ...(sidToAttach ? {session_id: sidToAttach} : {}),

      client_ts: new Date().toISOString(),
    };

    return this.enqueueEvent<T>(payload);
  }

  /**
   * @deprecated Use trackEvent(). Kept for backwards compatibility.
   */
  public async createEvent<T = {success: true; id?: number}>(
    data: TrackEventPayload
  ): Promise<T> {
    return this.trackEvent<T>(data);
  }

  /**
   * Create items.
   * POST /v1/items
   */
  public async upsertItem<T = {success: true; itemId?: string}>(
    data: ItemUpsertPayload | ItemUpsertPayload[]
  ): Promise<T> {
    const payload = Array.isArray(data)
      ? data.map((item) => normalizeItemPayload(item))
      : normalizeItemPayload(data);

    return this.request<T>("/items", {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(payload),
    });
  }

  public async createItem<T = {id: string; object: "item"}>(
    data: ItemUpsertPayload
  ): Promise<T> {
    return this.upsertItem<T>(data);
  }

  /**
   * Update a single item.
   * POST /v1/items/{item_id}
   */
  public async patchItem<T = PatchItemResponse>(
    input: PatchItemInput
  ): Promise<T> {
    const itemId = getItemId(input);

    if (!isValidItemId(itemId)) {
      throw new Error(
        "itemId is required and must be a prefixed string like itm_abc123"
      );
    }

    const {id: _id, itemId: _itemId, item_id: _item_id, ...patch} = input;

    if (!patch || Object.keys(patch).length === 0) {
      throw new Error(
        "patchItem requires at least one field to update (e.g. { active: false })"
      );
    }

    return this.request<T>(`/items/${encodeURIComponent(String(itemId))}`, {
      method: "POST",
      headers: this.getHeaders(),
      body: JSON.stringify(patch),
    });
  }

  /**
   * Convenience helper: enable/disable item
   */
  public async setItemActive<T = PatchItemResponse>(
    itemId: string,
    active: boolean
  ): Promise<T> {
    return this.patchItem<T>({itemId, active});
  }

  /**
   * Delete one or more items.
   * DELETE /v1/items/{item_id}
   */
  public async deleteItems<T = DeleteItemsResponse>(
    items: DeleteItemInput | DeleteItemInput[]
  ): Promise<T> {
    const payload = Array.isArray(items) ? items : [items];

    const itemIds = payload.map((entry) => getItemId(entry));
    if (itemIds.length === 0 || itemIds.some((id) => !isValidItemId(id))) {
      throw new Error(
        "itemId is required and must be a prefixed string like itm_abc123"
      );
    }

    const responses = [];
    for (const itemId of itemIds) {
      responses.push(
        await this.request<unknown>(
          `/items/${encodeURIComponent(String(itemId))}`,
          {
            method: "DELETE",
            headers: this.getHeaders(),
          }
        )
      );
    }

    if (responses.length === 1) {
      return responses[0] as T;
    }

    return {
      message: "Items deleted successfully",
      object: "list",
      itemIds: itemIds as string[],
      deletedCount: responses.length,
      data: responses,
    } as T;
  }

  /**
   * Get recommendations for a user
   * GET /v1/recommendations?user_id=...&context_id=...&limit=...
   *
   * ✅ Captures request_id for correlation if present.
   */
  public async getRecommendations(
    options: RecommendationOptions
  ): Promise<RecommendationsResponse> {
    const {userId, contextId, contextKey, scope, limit, startingAfter, starting_after} = options;
    if (typeof userId !== "number" && typeof userId !== "string") {
      throw new Error("userId must be a string or number");
    }

    const url = new URL(`${this.baseUrl}/recommendations`);
    url.searchParams.set("user_id", String(userId));
    if (contextId) url.searchParams.set("context_id", contextId);
    if (contextKey) url.searchParams.set("context_key", contextKey);
    if (scope) url.searchParams.set("scope", JSON.stringify(scope));
    if (typeof limit === "number") url.searchParams.set("limit", String(limit));
    if (startingAfter || starting_after)
      url.searchParams.set("starting_after", String(startingAfter ?? starting_after));

    const res = await this.request<RecommendationsResponse>(url.toString(), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (this.propagateRecommendationRequestId && res?.request_id) {
      this.lastRecommendationRequestId = res.request_id;
    }

    return res;
  }

  /**
   * Get the next auto-generated recommendation section.
   * GET /v1/recommendations?mode=auto&user_id=...&cursor=...&limit=...
   *
   * ✅ Captures request_id for correlation if present.
   */
  public async getAutoRecommendations(
    options: AutoRecommendationsOptions
  ): Promise<RecommendationsResponse> {
    const {
      userId,
      contextId,
      contextKey,
      scope,
      limit,
      cursor,
      windowDays,
      candidateLimit,
      servedCap,
    } = options;

    if (typeof userId !== "number" && typeof userId !== "string") {
      throw new Error("userId must be a string or number");
    }

    const url = new URL(`${this.baseUrl}/recommendations`);
    url.searchParams.set("mode", "auto");
    url.searchParams.set("user_id", String(userId));
    if (contextId) url.searchParams.set("context_id", contextId);
    if (contextKey) url.searchParams.set("context_key", contextKey);
    if (scope) url.searchParams.set("scope", JSON.stringify(scope));
    if (typeof limit === "number") url.searchParams.set("limit", String(limit));
    if (cursor) url.searchParams.set("cursor", cursor);
    if (typeof windowDays === "number")
      url.searchParams.set("window_days", String(windowDays));
    if (typeof candidateLimit === "number")
      url.searchParams.set("candidate_limit", String(candidateLimit));
    if (typeof servedCap === "number")
      url.searchParams.set("served_cap", String(servedCap));

    const res = await this.request<RecommendationsResponse>(url.toString(), {
      method: "GET",
      headers: this.getHeaders(),
    });

    if (this.propagateRecommendationRequestId && res?.request_id) {
      this.lastRecommendationRequestId = res.request_id;
    }

    return res;
  }
}

export default NeuronSDK;
