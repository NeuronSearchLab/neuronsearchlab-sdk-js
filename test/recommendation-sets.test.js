import assert from "node:assert/strict";
import {test} from "node:test";

import {MAX_RECOMMENDATION_SETS_PER_BATCH, NeuronSDK} from "../dist/index.cjs";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function sdkRecording(respond) {
  const requests = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "token",
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body);
      requests.push({url, init, body});
      return new Response(JSON.stringify(respond(body)), {status: 200, headers: {"Content-Type": "application/json"}});
    },
  });
  return {sdk, requests};
}

const ok = (body) => ({
  object: "recommendation_set_list",
  request_id: body.request_id,
  results: body.requests.map((set) => ({key: set.key, status: 200, request_id: `${set.key}-id`, context_id: set.context_id, data: [{id: 1}]})),
  usage: {sets: body.requests.length, computed: body.requests.length, reused: 0, coalesced: 0},
});

test("getRecommendationSets sends every rail in one batch request", async () => {
  const {sdk, requests} = sdkRecording(ok);
  const response = await sdk.getRecommendationSets({
    userId: "u1",
    sessionId: "s1",
    sets: [
      {key: "for_you", contextId: 101, limit: 12},
      {key: "similar", contextId: 102, limit: 4, itemId: 55, filters: ["type:van"]},
    ],
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, "https://api.example.com/v1/recommendations/batch");
  assert.equal(requests[0].init.method, "POST");
  assert.deepEqual(requests[0].body.requests, [
    {key: "for_you", context_id: 101, limit: 12},
    {key: "similar", context_id: 102, limit: 4, item_id: 55, filters: ["type:van"]},
  ]);
  assert.equal(requests[0].body.user_id, "u1");
  assert.equal(requests[0].body.session_id, "s1");
  assert.match(requests[0].body.request_id, UUID);
  assert.equal(new Headers(requests[0].init.headers).get("x-request-id"), null);

  assert.deepEqual(response.results.map((result) => result.key), ["for_you", "similar"]);
  assert.equal(response.sets.similar.request_id, "similar-id");
  assert.deepEqual(response.usage, {sets: 2, computed: 2, reused: 0, coalesced: 0});
});

test("a caller-supplied requestId makes the call idempotent", async () => {
  const {sdk, requests} = sdkRecording(ok);
  const requestId = "11111111-1111-4111-8111-111111111111";
  await sdk.getRecommendationSets({userId: "u1", requestId, sets: [{key: "a", contextId: 1}]});
  assert.equal(requests[0].body.request_id, requestId);
});

test("splits more than the per-batch maximum into parallel batches", async () => {
  const {sdk, requests} = sdkRecording(ok);
  const sets = Array.from({length: MAX_RECOMMENDATION_SETS_PER_BATCH + 2}, (_, i) => ({key: `rail_${i}`, contextId: i + 1}));
  const response = await sdk.getRecommendationSets({anonymousId: "anon", sets});
  assert.equal(requests.length, 2);
  assert.equal(requests[0].body.requests.length, MAX_RECOMMENDATION_SETS_PER_BATCH);
  assert.equal(requests[1].body.requests.length, 2);
  assert.notEqual(requests[0].body.request_id, requests[1].body.request_id);
  assert.deepEqual(response.results.map((result) => result.key), sets.map((set) => set.key));
  assert.equal(response.usage.sets, sets.length);
});

test("a failing set comes back with its own error", async () => {
  const {sdk} = sdkRecording((body) => ({
    results: [
      {key: "good", status: 200, request_id: "g", context_id: 1, data: []},
      {key: "gone", status: 404, request_id: "x", context_id: 999, error: {code: "invalid_context", message: "Context not found"}},
    ],
  }));
  const response = await sdk.getRecommendationSets({userId: "u", sets: [{key: "good", contextId: 1}, {key: "gone", contextId: 999}]});
  assert.equal(response.sets.gone.status, 404);
  assert.equal(response.sets.gone.error.code, "invalid_context");
  assert.equal(response.sets.good.status, 200);
});

test("rejects invalid sets before calling the API", async () => {
  const {sdk, requests} = sdkRecording(ok);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", sets: []}), /non-empty/);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", sets: [{key: "bad key", contextId: 1}]}), /must match/);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", sets: [{key: "a", contextId: 1}, {key: "a", contextId: 2}]}), /Duplicate/);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", sets: [{key: "a", contextId: 0}]}), /contextId/);
  assert.equal(requests.length, 0);
});

test("a groupId loads every rail of a context group in one batch", async () => {
  const {sdk, requests} = sdkRecording((body) => ({
    object: "recommendation_set_list",
    group_id: body.group_id,
    results: [
      {key: "for_you", status: 200, request_id: "a", context_id: 2323, data: []},
      {key: "similar", status: 200, request_id: "b", context_id: 2324, data: []},
    ],
    usage: {sets: 2, computed: 2, reused: 0, coalesced: 0},
  }));
  const response = await sdk.getRecommendationSets({
    userId: "u1",
    groupId: 12,
    limit: 6,
    sets: [{contextId: 2324, itemId: 3187}],
  });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.group_id, 12);
  assert.equal(requests[0].body.limit, 6);
  assert.deepEqual(requests[0].body.requests, [{context_id: 2324, item_id: 3187}]);
  assert.equal(response.group_id, 12);
  assert.deepEqual(Object.keys(response.sets), ["for_you", "similar"]);
});

test("a group request needs no sets, and limit needs a group", async () => {
  const {sdk, requests} = sdkRecording(ok);
  await sdk.getRecommendationSets({userId: "u1", groupId: 12});
  assert.deepEqual(requests[0].body.requests, []);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", groupId: 0}), /groupId/);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", limit: 5, sets: [{key: "a", contextId: 1}]}), /group request/);
  await assert.rejects(() => sdk.getRecommendationSets({userId: "u", sets: [{contextId: 1}]}), /must match/);
});
