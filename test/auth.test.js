import assert from "node:assert/strict";
import {test} from "node:test";

import {
  NeuronSDK,
  SDKAuthError,
  SDKHttpError,
} from "../dist/index.cjs";

const recommendationResponse = () =>
  new Response(JSON.stringify({object: "list", recommendations: []}), {
    status: 200,
    headers: {"Content-Type": "application/json"},
  });

const authorizationHeader = (init) => new Headers(init.headers).get("authorization");

test("static accessToken remains backward compatible and a 401 is not retried", async () => {
  let calls = 0;
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    accessToken: "static-token",
    maxRetries: 5,
    fetchImpl: async (_url, init) => {
      calls += 1;
      assert.equal(authorizationHeader(init), "Bearer static-token");
      return new Response(JSON.stringify({error: "unauthorized"}), {status: 401});
    },
  });

  await assert.rejects(
    sdk.getRecommendations({userId: "user-1"}),
    (error) => error instanceof SDKHttpError && error.status === 401
  );
  assert.equal(calls, 1);
});

test("static auth works with a custom fetch in runtimes without global Headers", async () => {
  const originalHeaders = globalThis.Headers;
  let receivedHeaders;
  globalThis.Headers = undefined;

  try {
    const sdk = new NeuronSDK({
      baseUrl: "https://api.example.com/v1",
      accessToken: "legacy-runtime-token",
      fetchImpl: async (_url, init) => {
        receivedHeaders = init.headers;
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify({recommendations: []}),
        };
      },
    });

    await sdk.getRecommendations({userId: "legacy-runtime"});
    assert.equal(receivedHeaders.Authorization, "Bearer legacy-runtime-token");
    assert.equal(receivedHeaders["Content-Type"], "application/json");
  } finally {
    globalThis.Headers = originalHeaders;
  }
});

test("async tokenProvider is singleflight and caches its result", async () => {
  const providerContexts = [];
  const authorizationValues = [];
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    tokenProvider: async (context) => {
      providerContexts.push(context);
      await new Promise((resolve) => setTimeout(resolve, 10));
      return {accessToken: "provider-token", expiresInSeconds: 3600};
    },
    fetchImpl: async (_url, init) => {
      authorizationValues.push(authorizationHeader(init));
      return recommendationResponse();
    },
  });

  await Promise.all(
    Array.from({length: 8}, (_, index) =>
      sdk.getRecommendations({userId: `user-${index}`})
    )
  );
  await sdk.getRecommendations({userId: "user-cached"});

  assert.deepEqual(providerContexts, [
    {forceRefresh: false, reason: "initial"},
  ]);
  assert.deepEqual(
    authorizationValues,
    Array(9).fill("Bearer provider-token")
  );
});

test("provider tokens refresh inside the configured expiry skew", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  let providerCalls = 0;

  Date.now = () => now;
  try {
    const sdk = new NeuronSDK({
      baseUrl: "https://api.example.com/v1",
      tokenProvider: async () => ({
        accessToken: `token-${++providerCalls}`,
        expiresAt: now + 10_000,
      }),
      tokenExpirySkewMs: 2_000,
      fetchImpl: async () => recommendationResponse(),
    });

    await sdk.getRecommendations({userId: "before-skew"});
    now += 7_999;
    await sdk.getRecommendations({userId: "still-cached"});
    assert.equal(providerCalls, 1);

    now += 2;
    await sdk.getRecommendations({userId: "inside-skew"});
    assert.equal(providerCalls, 2);
  } finally {
    Date.now = originalNow;
  }
});

test("OAuth client credentials use Basic auth, cache tokens, and singleflight concurrent requests", async () => {
  const tokenUrl = "https://auth.example.com/oauth2/token";
  const clientId = "server-client";
  const clientSecret = "server-secret";
  let tokenCalls = 0;
  let apiCalls = 0;

  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    oauthClientCredentials: {
      tokenUrl,
      clientId,
      clientSecret,
      scope: ["recommendations:read", "events:write"],
      audience: "https://api.example.com",
    },
    fetchImpl: async (url, init) => {
      if (String(url) === tokenUrl) {
        tokenCalls += 1;
        assert.equal(init.method, "POST");
        assert.equal(
          authorizationHeader(init),
          `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
        );
        assert.equal(
          new Headers(init.headers).get("content-type"),
          "application/x-www-form-urlencoded"
        );
        const body = new URLSearchParams(init.body);
        assert.equal(body.get("grant_type"), "client_credentials");
        assert.equal(body.get("scope"), "recommendations:read events:write");
        assert.equal(body.get("audience"), "https://api.example.com");
        await new Promise((resolve) => setTimeout(resolve, 10));
        return new Response(
          JSON.stringify({
            access_token: "oauth-access-token",
            token_type: "Bearer",
            expires_in: 3600,
          }),
          {status: 200}
        );
      }

      apiCalls += 1;
      assert.equal(authorizationHeader(init), "Bearer oauth-access-token");
      return recommendationResponse();
    },
  });

  await Promise.all([
    sdk.getRecommendations({userId: "user-a"}),
    sdk.getRecommendations({userId: "user-b"}),
    sdk.getRecommendations({userId: "user-c"}),
  ]);
  await sdk.getRecommendations({userId: "user-d"});

  assert.equal(tokenCalls, 1);
  assert.equal(apiCalls, 4);
});

test("OAuth mode uses NSL defaults and refreshes once after a 401", async () => {
  const defaultTokenUrl = "https://auth.neuronsearchlab.com/oauth2/token";
  let tokenCalls = 0;
  let apiCalls = 0;

  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    oauthClientCredentials: {
      clientId: "server-client",
      clientSecret: "server-secret",
    },
    fetchImpl: async (url, init) => {
      if (String(url) === defaultTokenUrl) {
        tokenCalls += 1;
        const body = new URLSearchParams(init.body);
        assert.equal(
          body.get("scope"),
          "neuronsearchlab-api/read neuronsearchlab-api/write"
        );
        return new Response(
          JSON.stringify({
            access_token: `oauth-token-${tokenCalls}`,
            token_type: "Bearer",
            expires_in: 3600,
          }),
          {status: 200}
        );
      }

      apiCalls += 1;
      if (authorizationHeader(init) === "Bearer oauth-token-1") {
        return new Response(JSON.stringify({error: "expired_token"}), {
          status: 401,
        });
      }
      assert.equal(authorizationHeader(init), "Bearer oauth-token-2");
      return recommendationResponse();
    },
  });

  await sdk.getRecommendations({userId: "user-1"});
  assert.equal(tokenCalls, 2);
  assert.equal(apiCalls, 2);
});

test("concurrent 401 responses trigger one refresh and one retry per request", async () => {
  const providerContexts = [];
  let staleRequests = 0;
  let allStaleRequestsStarted;
  const staleRequestsStarted = new Promise((resolve) => {
    allStaleRequestsStarted = resolve;
  });
  const authorizationValues = [];

  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    maxRetries: 5,
    tokenProvider: async (context) => {
      providerContexts.push(context);
      if (context.forceRefresh) {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return "fresh-token";
      }
      return "stale-token";
    },
    fetchImpl: async (_url, init) => {
      const authorization = authorizationHeader(init);
      authorizationValues.push(authorization);
      if (authorization === "Bearer stale-token") {
        staleRequests += 1;
        if (staleRequests === 2) allStaleRequestsStarted();
        await staleRequestsStarted;
        return new Response(JSON.stringify({error: "expired_token"}), {
          status: 401,
        });
      }
      assert.equal(authorization, "Bearer fresh-token");
      return recommendationResponse();
    },
  });

  await Promise.all([
    sdk.getRecommendations({userId: "user-a"}),
    sdk.getRecommendations({userId: "user-b"}),
  ]);

  assert.deepEqual(providerContexts, [
    {forceRefresh: false, reason: "initial"},
    {forceRefresh: true, reason: "unauthorized"},
  ]);
  assert.equal(authorizationValues.length, 4);
  assert.equal(
    authorizationValues.filter((value) => value === "Bearer stale-token").length,
    2
  );
  assert.equal(
    authorizationValues.filter((value) => value === "Bearer fresh-token").length,
    2
  );
});

test("a second 401 is returned without another refresh or hidden retry", async () => {
  let providerCalls = 0;
  let apiCalls = 0;
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    maxRetries: 5,
    tokenProvider: async () => `token-${++providerCalls}`,
    fetchImpl: async () => {
      apiCalls += 1;
      return new Response(JSON.stringify({error: "unauthorized"}), {status: 401});
    },
  });

  await assert.rejects(
    sdk.getRecommendations({userId: "user-1"}),
    (error) => error instanceof SDKHttpError && error.status === 401
  );
  assert.equal(providerCalls, 2);
  assert.equal(apiCalls, 2);
});

test("event buffering does not turn a final 401 into background retries", async () => {
  let providerCalls = 0;
  let apiCalls = 0;
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    tokenProvider: async () => `event-token-${++providerCalls}`,
    collateWindowSeconds: 0,
    maxEventRetries: 5,
    fetchImpl: async () => {
      apiCalls += 1;
      return new Response(JSON.stringify({error: "unauthorized"}), {status: 401});
    },
  });

  await assert.rejects(
    sdk.trackEvent({eventId: 41, userId: "user-1", itemId: 1}),
    (error) => error instanceof SDKHttpError && error.status === 401
  );
  await new Promise((resolve) => setTimeout(resolve, 20));

  assert.equal(providerCalls, 2);
  assert.equal(apiCalls, 2);
});

test("OAuth client credentials are rejected in browser runtimes", () => {
  const originalWindow = globalThis.window;
  globalThis.window = {};
  try {
    assert.throws(
      () =>
        new NeuronSDK({
          baseUrl: "https://api.example.com/v1",
          oauthClientCredentials: {
            clientId: "client-id",
            clientSecret: "must-not-reach-a-browser",
          },
          fetchImpl: async () => recommendationResponse(),
        }),
      (error) =>
        error instanceof SDKAuthError &&
        error.message.includes("server-only") &&
        error.message.includes("Never ship a client secret")
    );
  } finally {
    if (originalWindow === undefined) delete globalThis.window;
    else globalThis.window = originalWindow;
  }
});

test("OAuth issuer errors never expose response bodies or client secrets", async () => {
  const secret = "do-not-expose-this-secret";
  const sdk = new NeuronSDK({
    baseUrl: "https://api.example.com/v1",
    oauthClientCredentials: {
      tokenUrl: "https://auth.example.com/oauth2/token",
      clientId: "client-id",
      clientSecret: secret,
    },
    fetchImpl: async () =>
      new Response(`issuer echoed ${secret}`, {
        status: 401,
        statusText: "Unauthorized",
      }),
  });

  await assert.rejects(
    sdk.getRecommendations({userId: "user-1"}),
    (error) =>
      error instanceof SDKAuthError &&
      error.status === 401 &&
      !error.message.includes(secret) &&
      !error.message.includes("issuer echoed")
  );
});
