const DEFAULT_TOKEN_URL = "https://auth.neuronsearchlab.com/oauth2/token";
const DEFAULT_SCOPE = [
  "neuronsearchlab-api/read",
  "neuronsearchlab-api/write",
] as const;
const DEFAULT_EXPIRY_SKEW_MS = 60_000;

export type TokenProviderReason = "initial" | "expired" | "unauthorized";

export type TokenProviderContext = {
  /**
   * True only when the API rejected the previously returned token with a 401.
   * Providers that maintain their own cache should bypass it in this case.
   */
  forceRefresh: boolean;
  reason: TokenProviderReason;
};

export type TokenProviderResult =
  | string
  | {
      accessToken: string;
      /** Absolute expiry as a Date or Unix epoch time in milliseconds. */
      expiresAt?: Date | number;
      /** Relative expiry, measured from when the provider resolves. */
      expiresInSeconds?: number;
    };

export type TokenProvider = (
  context: TokenProviderContext
) => TokenProviderResult | Promise<TokenProviderResult>;

/**
 * OAuth 2.0 client-credentials configuration for trusted server runtimes only.
 * Never include a client secret in browser, mobile, desktop, or other
 * user-distributed code. Route those clients through your backend instead.
 */
export type OAuthClientCredentialsConfig = {
  clientId: string;
  clientSecret: string;
  /** Defaults to NeuronSearchLab's hosted OAuth token endpoint. */
  tokenUrl?: string;
  /** Defaults to the NeuronSearchLab read and write scopes. */
  scope?: string | readonly string[];
  /** Optional OAuth audience parameter, when required by a custom issuer. */
  audience?: string;
  /** Additional non-secret form parameters required by a custom issuer. */
  additionalParameters?: Readonly<Record<string, string>>;
};

export class SDKAuthError extends Error {
  public status?: number;
  public cause?: unknown;

  constructor(message: string, options: {status?: number; cause?: unknown} = {}) {
    super(message);
    this.name = "SDKAuthError";
    this.status = options.status;
    this.cause = options.cause;
  }
}

export type AuthManagerConfig = {
  accessToken?: string;
  tokenProvider?: TokenProvider;
  oauthClientCredentials?: OAuthClientCredentialsConfig;
  tokenExpirySkewMs?: number;
  fetchImpl: typeof fetch;
  timeoutMs: number;
};

export type AuthTokenSnapshot = {
  value: string;
  generation: number;
};

type CachedToken = AuthTokenSnapshot & {
  issuedAt: number;
  expiresAt: number | null;
};

const normalizeNonEmpty = (value: unknown): string | null => {
  if (typeof value !== "string") return null;
  const normalized = value.trim();
  return normalized || null;
};

const preserveNonBlank = (value: unknown): string | null => {
  if (typeof value !== "string" || !value.trim()) return null;
  return value;
};

const isBrowserRuntime = (): boolean =>
  typeof window !== "undefined" || typeof document !== "undefined";

const normalizeTokenUrl = (value?: string): string => {
  const raw = normalizeNonEmpty(value) ?? DEFAULT_TOKEN_URL;
  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    throw new SDKAuthError("OAuth tokenUrl must be a valid absolute URL");
  }

  const isLoopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "::1";

  if (url.protocol !== "https:" && !(url.protocol === "http:" && isLoopback)) {
    throw new SDKAuthError(
      "OAuth tokenUrl must use HTTPS (HTTP is allowed only for loopback development)"
    );
  }

  if (url.username || url.password) {
    throw new SDKAuthError("OAuth tokenUrl must not include URL credentials");
  }

  return url.toString();
};

const normalizeScope = (value?: string | readonly string[]): string => {
  const values = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(/\s+/)
      : DEFAULT_SCOPE;

  const scope = values
    .map((entry) => String(entry).trim())
    .filter(Boolean)
    .join(" ");

  if (!scope) {
    throw new SDKAuthError("OAuth scope must contain at least one scope");
  }

  return scope;
};

const encodeBasicCredentials = (clientId: string, clientSecret: string): string => {
  const value = `${clientId}:${clientSecret}`;
  const maybeBuffer = (
    globalThis as typeof globalThis & {
      Buffer?: {
        from(input: string, encoding: string): {toString(encoding: string): string};
      };
    }
  ).Buffer;

  if (maybeBuffer) {
    return maybeBuffer.from(value, "utf8").toString("base64");
  }

  if (typeof btoa === "function") {
    const bytes = new TextEncoder().encode(value);
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary);
  }

  throw new SDKAuthError("This server runtime cannot encode OAuth credentials");
};

const normalizeExpiry = (
  result: Exclude<TokenProviderResult, string>,
  issuedAt: number
): number | null => {
  if (result.expiresAt !== undefined) {
    const expiresAt =
      result.expiresAt instanceof Date
        ? result.expiresAt.getTime()
        : result.expiresAt;
    if (!Number.isFinite(expiresAt) || expiresAt <= issuedAt) {
      throw new SDKAuthError("Token provider expiresAt must be a future epoch time");
    }
    return expiresAt;
  }

  if (result.expiresInSeconds !== undefined) {
    if (
      !Number.isFinite(result.expiresInSeconds) ||
      result.expiresInSeconds <= 0
    ) {
      throw new SDKAuthError("Token provider expiresInSeconds must be positive");
    }
    return issuedAt + result.expiresInSeconds * 1000;
  }

  return null;
};

export class AccessTokenManager {
  private staticAccessToken: string | null;
  private tokenProvider?: TokenProvider;
  private oauthClientCredentials?: OAuthClientCredentialsConfig & {
    tokenUrl: string;
    scope: string;
  };
  private readonly fetchImpl: typeof fetch;
  private timeoutMs: number;
  private readonly tokenExpirySkewMs: number;
  private cachedToken: CachedToken | null = null;
  private inflight: Promise<CachedToken> | null = null;
  private generation = 0;

  constructor(config: AuthManagerConfig) {
    const accessToken = preserveNonBlank(config.accessToken);
    const hasTokenProvider = typeof config.tokenProvider === "function";
    const hasClientCredentials = Boolean(config.oauthClientCredentials);
    const configuredMethods = [
      Boolean(accessToken),
      hasTokenProvider,
      hasClientCredentials,
    ].filter(Boolean).length;

    if (configuredMethods !== 1) {
      throw new SDKAuthError(
        "Configure exactly one authentication method: accessToken, tokenProvider, or oauthClientCredentials"
      );
    }

    if (
      config.tokenExpirySkewMs !== undefined &&
      (!Number.isFinite(config.tokenExpirySkewMs) || config.tokenExpirySkewMs < 0)
    ) {
      throw new SDKAuthError("tokenExpirySkewMs must be a non-negative number");
    }

    this.fetchImpl = config.fetchImpl;
    this.timeoutMs = config.timeoutMs;
    this.tokenExpirySkewMs =
      config.tokenExpirySkewMs ?? DEFAULT_EXPIRY_SKEW_MS;
    this.staticAccessToken = accessToken;
    this.tokenProvider = config.tokenProvider;

    if (config.oauthClientCredentials) {
      if (isBrowserRuntime()) {
        throw new SDKAuthError(
          "oauthClientCredentials is server-only. Never ship a client secret to a browser; call NeuronSearchLab through your backend instead."
        );
      }

      const clientId = preserveNonBlank(config.oauthClientCredentials.clientId);
      const clientSecret = preserveNonBlank(
        config.oauthClientCredentials.clientSecret
      );
      if (!clientId || !clientSecret) {
        throw new SDKAuthError(
          "oauthClientCredentials requires non-empty clientId and clientSecret values"
        );
      }

      const additionalParameters =
        config.oauthClientCredentials.additionalParameters ?? {};
      const reservedKeys = new Set([
        "grant_type",
        "client_id",
        "client_secret",
        "scope",
      ]);
      for (const key of Object.keys(additionalParameters)) {
        if (reservedKeys.has(key)) {
          throw new SDKAuthError(
            `OAuth additionalParameters cannot override reserved parameter ${key}`
          );
        }
      }

      this.oauthClientCredentials = {
        ...config.oauthClientCredentials,
        clientId,
        clientSecret,
        tokenUrl: normalizeTokenUrl(config.oauthClientCredentials.tokenUrl),
        scope: normalizeScope(config.oauthClientCredentials.scope),
      };
    }
  }

  public isRefreshable(): boolean {
    return Boolean(this.tokenProvider || this.oauthClientCredentials);
  }

  public setTimeoutMs(timeoutMs: number): void {
    this.timeoutMs = timeoutMs;
  }

  public setStaticAccessToken(token: string): void {
    const normalized = preserveNonBlank(token);
    if (!normalized) {
      throw new SDKAuthError("accessToken must be a non-empty string");
    }

    this.staticAccessToken = normalized;
    this.tokenProvider = undefined;
    this.oauthClientCredentials = undefined;
    this.cachedToken = null;
    this.inflight = null;
    this.generation += 1;
  }

  public async getToken(): Promise<AuthTokenSnapshot> {
    if (this.staticAccessToken) {
      return {value: this.staticAccessToken, generation: this.generation};
    }

    if (this.cachedToken && this.isFresh(this.cachedToken)) {
      return this.cachedToken;
    }

    return this.startAcquisition(this.cachedToken ? "expired" : "initial");
  }

  public async refreshAfterUnauthorized(
    rejectedGeneration: number
  ): Promise<AuthTokenSnapshot | null> {
    if (!this.isRefreshable()) return null;

    if (
      this.cachedToken &&
      this.cachedToken.generation !== rejectedGeneration &&
      this.isFresh(this.cachedToken)
    ) {
      return this.cachedToken;
    }

    if (this.inflight) return this.inflight;

    this.cachedToken = null;
    return this.startAcquisition("unauthorized");
  }

  private isFresh(token: CachedToken): boolean {
    if (token.expiresAt === null) return true;

    const lifetimeMs = Math.max(0, token.expiresAt - token.issuedAt);
    const effectiveSkewMs = Math.min(
      this.tokenExpirySkewMs,
      lifetimeMs / 2
    );
    return Date.now() < token.expiresAt - effectiveSkewMs;
  }

  private async startAcquisition(
    reason: TokenProviderReason
  ): Promise<CachedToken> {
    if (this.inflight) return this.inflight;

    const promise = this.acquire(reason);
    this.inflight = promise;

    try {
      return await promise;
    } finally {
      if (this.inflight === promise) this.inflight = null;
    }
  }

  private async acquire(reason: TokenProviderReason): Promise<CachedToken> {
    let result: TokenProviderResult;

    if (this.tokenProvider) {
      try {
        result = await this.tokenProvider({
          forceRefresh: reason === "unauthorized",
          reason,
        });
      } catch (cause) {
        throw new SDKAuthError("Token provider failed", {cause});
      }
    } else if (this.oauthClientCredentials) {
      result = await this.acquireClientCredentialsToken();
    } else {
      throw new SDKAuthError("No authentication method is configured");
    }

    const issuedAt = Date.now();
    const accessToken = preserveNonBlank(
      typeof result === "string" ? result : result.accessToken
    );
    if (!accessToken) {
      throw new SDKAuthError("Token provider returned an empty access token");
    }

    const expiresAt =
      typeof result === "string" ? null : normalizeExpiry(result, issuedAt);
    const cachedToken: CachedToken = {
      value: accessToken,
      issuedAt,
      expiresAt,
      generation: ++this.generation,
    };
    this.cachedToken = cachedToken;
    return cachedToken;
  }

  private async acquireClientCredentialsToken(): Promise<TokenProviderResult> {
    const config = this.oauthClientCredentials;
    if (!config) {
      throw new SDKAuthError("OAuth client credentials are not configured");
    }

    const body = new URLSearchParams({
      grant_type: "client_credentials",
      scope: config.scope,
      ...(config.audience ? {audience: config.audience} : {}),
      ...(config.additionalParameters ?? {}),
    });
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await this.fetchImpl(config.tokenUrl, {
        method: "POST",
        headers: {
          Authorization: `Basic ${encodeBasicCredentials(
            config.clientId,
            config.clientSecret
          )}`,
          "Content-Type": "application/x-www-form-urlencoded",
          Accept: "application/json",
        },
        body: body.toString(),
        signal: controller.signal,
      });
    } catch (cause: any) {
      if (cause?.name === "AbortError") {
        throw new SDKAuthError(
          `OAuth token request timed out after ${this.timeoutMs} ms`,
          {cause}
        );
      }
      throw new SDKAuthError("OAuth token request failed", {cause});
    } finally {
      clearTimeout(timeout);
    }

    if (!response.ok) {
      // Consume the response so the connection can be reused, but never include
      // an issuer response body in logs or errors: issuers can echo credentials.
      await response.text().catch(() => "");
      throw new SDKAuthError(
        `OAuth token request failed with HTTP ${response.status}`,
        {status: response.status}
      );
    }

    let payload: unknown;
    try {
      payload = JSON.parse(await response.text());
    } catch (cause) {
      throw new SDKAuthError("OAuth token response was not valid JSON", {cause});
    }

    if (!payload || typeof payload !== "object") {
      throw new SDKAuthError("OAuth token response must be a JSON object");
    }

    const tokenPayload = payload as Record<string, unknown>;
    const tokenType = normalizeNonEmpty(tokenPayload.token_type);
    if (tokenType && tokenType.toLowerCase() !== "bearer") {
      throw new SDKAuthError(
        `OAuth token type ${tokenType} is not supported; expected Bearer`
      );
    }

    const accessToken = preserveNonBlank(tokenPayload.access_token);
    if (!accessToken) {
      throw new SDKAuthError("OAuth token response did not include access_token");
    }

    let expiresInSeconds: number | undefined;
    if (tokenPayload.expires_in !== undefined) {
      expiresInSeconds = Number(tokenPayload.expires_in);
      if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
        throw new SDKAuthError(
          "OAuth token response expires_in must be a positive number"
        );
      }
    }

    return {accessToken, expiresInSeconds};
  }
}
