import assert from "node:assert/strict";
import {afterEach, beforeEach, test} from "node:test";

import {NeuronSDK} from "../dist/index.cjs";

const wait = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

let originalWindow;
let originalDocument;

beforeEach(() => {
  originalWindow = globalThis.window;
  originalDocument = globalThis.document;
});

afterEach(() => {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
  if (originalDocument === undefined) {
    delete globalThis.document;
  } else {
    globalThis.document = originalDocument;
  }
});

test("batches events within collate window and preserves order", async () => {
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    collateWindowSeconds: 0.01,
    maxBatchSize: 10,
    fetchImpl: async (url, init) => {
      requests.push({url, init});
      return new Response(JSON.stringify({success: true}), {status: 200});
    },
  });

  const p1 = sdk.trackEvent({type: "view", userId: "u1", itemId: "itm_i1"});
  const p2 = sdk.trackEvent({type: "click", userId: "u1", itemId: "itm_i2"});

  await Promise.all([p1, p2]);
  assert.equal(requests.length, 1);

  const body = JSON.parse(requests[0].init.body);
  assert.equal(Array.isArray(body), true);
  assert.equal(body.length, 2);
  assert.equal(body[0].type, "view");
  assert.equal(body[0].user_id, "u1");
  assert.equal(body[0].item_id, "itm_i1");
  assert.equal(body[1].type, "click");
  assert.equal(body[1].item_id, "itm_i2");
  assert.ok(body[0].client_ts);
  assert.ok(body[1].client_ts);
});

test("flushes immediately when maxBatchSize is reached", async () => {
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    collateWindowSeconds: 10,
    maxBatchSize: 2,
    fetchImpl: async (url, init) => {
      requests.push({url, init});
      return new Response(JSON.stringify({success: true}), {status: 200});
    },
  });

  const p1 = sdk.trackEvent({type: "view", userId: "u1", itemId: "itm_i3"});
  const p2 = sdk.trackEvent({type: "click", userId: "u1", itemId: "itm_i4"});

  await Promise.all([p1, p2]);
  assert.equal(requests.length, 1);
  const body = JSON.parse(requests[0].init.body);
  assert.equal(body.length, 2);
});

test("retries after network failure and re-queues events", async () => {
  let attempts = 0;
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    collateWindowSeconds: 0,
    maxBatchSize: 5,
    maxEventRetries: 3,
    fetchImpl: async (url, init) => {
      attempts += 1;
      requests.push({url, init, attempt: attempts});
      if (attempts === 1) {
        throw new Error("network down");
      }
      return new Response(JSON.stringify({success: true}), {status: 200});
    },
  });

  // speed up retry backoff for test determinism
  sdk.backoffMs = () => 5;

  const p = sdk.trackEvent({type: "view", userId: "u1", itemId: "itm_i5"});
  await wait(20);
  await p;

  assert.equal(attempts, 2);
  const body = JSON.parse(requests.at(-1).init.body);
  const evt = Array.isArray(body) ? body[0] : body;
  assert.equal(evt.type, "view");
  assert.equal(evt.item_id, "itm_i5");
});

test("preserves ordering across multiple batches", async () => {
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    collateWindowSeconds: 0,
    maxBatchSize: 2,
    fetchImpl: async (url, init) => {
      requests.push({url, init});
      return new Response(JSON.stringify({success: true}), {status: 200});
    },
  });

  await Promise.all([
    sdk.trackEvent({type: "view", userId: "u1", itemId: "itm_i10"}),
    sdk.trackEvent({type: "click", userId: "u1", itemId: "itm_i11"}),
    sdk.trackEvent({type: "purchase", userId: "u1", itemId: "itm_i12"}),
  ]);

  assert.equal(requests.length, 2);
  const firstBatch = JSON.parse(requests[0].init.body);
  const secondBatch = JSON.parse(requests[1].init.body);
  const normalize = (body) => (Array.isArray(body) ? body : [body]);
  assert.deepEqual(
    normalize(firstBatch).map((e) => e.type),
    ["view", "click"]
  );
  assert.deepEqual(normalize(secondBatch).map((e) => e.type), ["purchase"]);
});

test("lifecycle flush triggers a send on pagehide", async () => {
  const listeners = {};
  globalThis.window = {
    addEventListener: (name, handler) => {
      listeners[name] = handler;
    },
  };
  globalThis.document = {visibilityState: "visible"};

  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    collateWindowSeconds: 5,
    maxBatchSize: 10,
    fetchImpl: async (url, init) => {
      requests.push({url, init});
      return new Response(JSON.stringify({success: true}), {status: 200});
    },
  });

  const p = sdk.trackEvent({type: "view", userId: "u1", itemId: "itm_i20"});
  listeners.pagehide();
  await Promise.all([p, wait(20)]);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].init.keepalive, true);
});
