import assert from "node:assert/strict";
import {afterEach, beforeEach, test} from "node:test";

import {NeuronSDK} from "../dist/index.cjs";

/** A localStorage stand-in that records every write. */
function fakeStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  const writes = [];
  return {
    data,
    writes,
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => {
      writes.push(["set", key, String(value)]);
      data.set(key, String(value));
    },
    removeItem: (key) => {
      writes.push(["remove", key]);
      data.delete(key);
    },
  };
}

function sdkRecording(config = {}, respond = () => ({success: true})) {
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    collateWindowSeconds: 0,
    fetchImpl: async (url, init) => {
      const body = init.body ? JSON.parse(init.body) : undefined;
      requests.push({url: String(url), init, body});
      return new Response(JSON.stringify(respond(String(url), body)), {status: 200});
    },
    ...config,
  });
  return {sdk, requests};
}

const firstEvent = (request) => [].concat(request.body)[0];

let originalLocalStorage;
let originalNow;

beforeEach(() => {
  originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  originalNow = Date.now;
});

afterEach(() => {
  Date.now = originalNow;
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete globalThis.localStorage;
  }
});

const installStorage = (storage) =>
  Object.defineProperty(globalThis, "localStorage", {value: storage, configurable: true, writable: true});

test("events fall back to the anonymous id and always carry it", async () => {
  const {sdk, requests} = sdkRecording({anonymousId: "anon-1"});
  assert.equal(sdk.getAnonymousId(), "anon-1");

  await sdk.trackEvent({eventId: 41, itemId: 1});
  assert.equal(firstEvent(requests[0]).user_id, "anon-1");
  assert.equal(firstEvent(requests[0]).anonymous_id, "anon-1");

  // An explicit user wins, and the anonymous id still travels with it.
  await sdk.trackEvent({eventId: 41, itemId: 1, userId: "u9"});
  assert.equal(firstEvent(requests[1]).user_id, "u9");
  assert.equal(firstEvent(requests[1]).anonymous_id, "anon-1");

  // Search events need no user either.
  await sdk.trackSearch({query: "vans"});
  assert.equal(firstEvent(requests[2]).user_id, "anon-1");

  await assert.rejects(() => sdk.trackEvent({eventId: 41, itemId: 1, userId: "  "}), /non-empty/);
});

test("an anonymous id is generated when none is configured", () => {
  const a = sdkRecording().sdk.getAnonymousId();
  const b = sdkRecording().sdk.getAnonymousId();
  assert.ok(a && b);
  assert.notEqual(a, b);
});

test("recommendation calls default user_id and send anonymous_id", async () => {
  const {sdk, requests} = sdkRecording({anonymousId: "anon-1"}, (url, body) =>
    body?.requests
      ? {results: body.requests.map((set) => ({key: set.key, status: 200, request_id: "r", context_id: set.context_id}))}
      : {recommendations: []}
  );

  await sdk.getRecommendations({contextId: 5});
  let url = new URL(requests[0].url);
  assert.equal(url.searchParams.get("user_id"), "anon-1");
  assert.equal(url.searchParams.get("anonymous_id"), "anon-1");

  await sdk.getAutoRecommendations({});
  url = new URL(requests[1].url);
  assert.equal(url.searchParams.get("mode"), "auto");
  assert.equal(url.searchParams.get("user_id"), "anon-1");
  assert.equal(url.searchParams.get("anonymous_id"), "anon-1");

  await sdk.getRecommendationSets({sets: [{key: "a", contextId: 1}]});
  assert.equal(requests[2].body.user_id, "anon-1");
  assert.equal(requests[2].body.anonymous_id, "anon-1");

  // A caller's userId still wins.
  await sdk.getRecommendations({userId: 42});
  assert.equal(new URL(requests[3].url).searchParams.get("user_id"), "42");
});

test("identify posts the link, then later calls default to the user", async () => {
  const {sdk, requests} = sdkRecording({anonymousId: "anon-1"}, (url) =>
    url.endsWith("/identify") ? {linked: true, events_moved: 3} : {recommendations: []}
  );

  const res = await sdk.identify("user-7");
  assert.deepEqual(res, {linked: true, events_moved: 3});
  assert.equal(requests[0].url, "https://api.example.com/v1/identify");
  assert.equal(requests[0].init.method, "POST");
  assert.equal(new Headers(requests[0].init.headers).get("authorization"), "Bearer token");
  assert.deepEqual(requests[0].body, {anonymous_id: "anon-1", user_id: "user-7", source: "js-sdk"});
  assert.equal(sdk.getUserId(), "user-7");

  await sdk.trackEvent({eventId: 41, itemId: 1});
  assert.equal(firstEvent(requests[1]).user_id, "user-7");
  assert.equal(firstEvent(requests[1]).anonymous_id, "anon-1");

  await sdk.getRecommendations({});
  assert.equal(new URL(requests[2].url).searchParams.get("user_id"), "user-7");

  // The same user again makes no request.
  const again = await sdk.identify("user-7");
  assert.equal(again.linked, false);
  assert.equal(requests.length, 3);
});

test("identify for another visitor's anonymous id leaves the default user alone", async () => {
  const {sdk, requests} = sdkRecording({anonymousId: "server"}, () => ({linked: true, events_moved: 1}));
  await sdk.identify("user-7", {anonymousId: "browser-anon"});
  assert.deepEqual(requests[0].body, {anonymous_id: "browser-anon", user_id: "user-7", source: "js-sdk"});
  assert.equal(sdk.getUserId(), null);
});

test("a failed identify keeps the visitor anonymous so a retry still links", async () => {
  let fail = true;
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    maxRetries: 0,
    fetchImpl: async (url, init) => {
      requests.push(init);
      if (fail) return new Response("{}", {status: 403, statusText: "Forbidden"});
      return new Response(JSON.stringify({linked: true, events_moved: 0}), {status: 200});
    },
  });
  await assert.rejects(() => sdk.identify("u1"), /HTTP 403/);
  assert.equal(sdk.getUserId(), null);
  fail = false;
  await sdk.identify("u1");
  assert.equal(requests.length, 2);
  assert.equal(sdk.getUserId(), "u1");
});

test("reset rotates the ids and forgets the user and request_id", async () => {
  const {sdk, requests} = sdkRecording({anonymousId: "anon-1"}, (url) =>
    url.endsWith("/identify") ? {linked: true, events_moved: 0} : {request_id: "rid-1", recommendations: []}
  );
  await sdk.identify("user-7");
  await sdk.getRecommendations({});
  assert.equal(sdk.getRequestId(), "rid-1");
  const session = sdk.getSessionId();

  sdk.reset();
  assert.notEqual(sdk.getAnonymousId(), "anon-1");
  assert.notEqual(sdk.getSessionId(), session);
  assert.equal(sdk.getUserId(), null);
  assert.equal(sdk.getRequestId(), null);

  await sdk.trackEvent({eventId: 41, itemId: 1});
  const event = firstEvent(requests.at(-1));
  assert.equal(event.user_id, sdk.getAnonymousId());
  assert.equal(event.session_id, sdk.getSessionId());
  assert.equal("request_id" in event, false);
});

test("memory persistence never touches localStorage", async () => {
  const storage = fakeStorage({nsl_aid: "stored"});
  installStorage(storage);
  const {sdk} = sdkRecording();
  assert.notEqual(sdk.getAnonymousId(), "stored");
  await sdk.trackEvent({eventId: 41, itemId: 1});
  sdk.reset();
  sdk.setConsent(false);
  sdk.setConsent(true);
  assert.deepEqual(storage.writes, []);
});

test("localStorage persistence restores and shares the nsl-embed keys", async () => {
  const storage = fakeStorage({nsl_aid: "embed-anon"});
  installStorage(storage);
  const {sdk} = sdkRecording({persistence: "localStorage"});
  assert.equal(sdk.getAnonymousId(), "embed-anon");

  await sdk.trackEvent({eventId: 41, itemId: 1});
  assert.equal(storage.data.get("nsl_sid"), sdk.getSessionId());
  assert.ok(Number(storage.data.get("nsl_sid_ts")) > 0);

  // A second instance (the next page load) picks up the same session.
  const next = sdkRecording({persistence: "localStorage"}).sdk;
  assert.equal(next.getAnonymousId(), "embed-anon");
  assert.equal(next.getSessionId(), sdk.getSessionId());

  sdk.reset();
  assert.equal(storage.data.get("nsl_aid"), sdk.getAnonymousId());
});

test("withheld consent stores nothing until granted", async () => {
  const storage = fakeStorage({nsl_aid: "old"});
  installStorage(storage);
  const {sdk} = sdkRecording({persistence: "localStorage", consent: false});
  assert.notEqual(sdk.getAnonymousId(), "old");
  await sdk.trackEvent({eventId: 41, itemId: 1});
  sdk.reset();
  assert.deepEqual(storage.writes, []);

  sdk.setConsent(true);
  assert.equal(storage.data.get("nsl_aid"), sdk.getAnonymousId());
  assert.equal(storage.data.get("nsl_sid"), sdk.getSessionId());
});

test("withdrawing consent removes the keys and rotates the ids", async () => {
  const storage = fakeStorage();
  installStorage(storage);
  const {sdk, requests} = sdkRecording({persistence: "localStorage"});
  await sdk.trackEvent({eventId: 41, itemId: 1});
  const anon = sdk.getAnonymousId();
  const session = sdk.getSessionId();

  sdk.setConsent(false);
  assert.equal(storage.data.size, 0);
  assert.notEqual(sdk.getAnonymousId(), anon);
  assert.notEqual(sdk.getSessionId(), session);

  const writesBefore = storage.writes.length;
  await sdk.trackEvent({eventId: 41, itemId: 1});
  assert.equal(storage.writes.length, writesBefore);
  assert.equal(firstEvent(requests.at(-1)).anonymous_id, sdk.getAnonymousId());
});

test("storage that throws is ignored", async () => {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error("SecurityError");
    },
  });
  const {sdk, requests} = sdkRecording({persistence: "localStorage"});
  await sdk.trackEvent({eventId: 41, itemId: 1});
  sdk.reset();
  sdk.setConsent(false);
  assert.ok(sdk.getAnonymousId());
  assert.equal(requests.length, 1);

  installStorage({
    getItem() { throw new Error("blocked"); },
    setItem() { throw new Error("quota"); },
    removeItem() { throw new Error("blocked"); },
  });
  const other = sdkRecording({persistence: "localStorage"}).sdk;
  await other.trackEvent({eventId: 41, itemId: 1});
  other.setConsent(false);
  assert.ok(other.getAnonymousId());
});

test("a managed session rotates after the inactivity timeout", async () => {
  let now = 1_000_000;
  Date.now = () => now;
  const {sdk, requests} = sdkRecording({sessionTimeoutMs: 1000});
  const first = sdk.getSessionId();

  now += 999;
  await sdk.trackEvent({eventId: 41, itemId: 1});
  assert.equal(firstEvent(requests[0]).session_id, first);

  // Activity pushed the deadline out.
  now += 999;
  assert.equal(sdk.getSessionId(), first);

  now += 1000;
  await sdk.trackEvent({eventId: 41, itemId: 1});
  const second = firstEvent(requests[1]).session_id;
  assert.notEqual(second, first);
  assert.equal(sdk.getSessionId(), second);
});

test("an explicit session id is never rotated", async () => {
  let now = 1_000_000;
  Date.now = () => now;
  const {sdk, requests} = sdkRecording({sessionId: "mine", sessionTimeoutMs: 1000});
  now += 10_000;
  await sdk.trackEvent({eventId: 41, itemId: 1});
  assert.equal(firstEvent(requests[0]).session_id, "mine");

  sdk.setSessionId("also-mine");
  now += 10_000;
  assert.equal(sdk.getSessionId(), "also-mine");

  // Clearing it hands the session back to the SDK, which manages it again.
  sdk.setSessionId(null);
  const managed = sdk.getSessionId();
  assert.ok(managed && managed !== "also-mine");
  now += 10_000;
  assert.notEqual(sdk.getSessionId(), managed);
});

test("an expired stored session is not restored", () => {
  const storage = fakeStorage({nsl_aid: "a", nsl_sid: "old-session", nsl_sid_ts: String(Date.now() - 31 * 60 * 1000)});
  installStorage(storage);
  const {sdk} = sdkRecording({persistence: "localStorage"});
  assert.notEqual(sdk.getSessionId(), "old-session");
  assert.equal(storage.data.get("nsl_sid"), sdk.getSessionId());
});
