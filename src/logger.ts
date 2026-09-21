export type LogLevelName = "TRACE" | "DEBUG" | "INFO" | "WARN" | "ERROR" | "FATAL";

const LEVEL_VALUES: Record<LogLevelName, number> = {
  TRACE: 10,
  DEBUG: 20,
  INFO: 30,
  WARN: 40,
  ERROR: 50,
  FATAL: 60,
};

export type StructuredLogEntry = {
  level: LogLevelName;
  levelValue: number;
  message: string;
  timestamp: string;
  context?: Record<string, unknown>;
};

export type LoggerTransport = (entry: StructuredLogEntry) => void;

export type LoggerConfig = {
  /**
   * Global log level. TRACE is the most verbose, FATAL is the most quiet.
   * Defaults to INFO for production-friendly output.
   */
  level?: LogLevelName | number;
  /**
   * When true, request/response bodies will be included in TRACE/DEBUG logs.
   * Remains disabled by default to avoid leaking sensitive data.
   */
  enableNetworkBodyLogging?: boolean;
  /**
   * Enables timing/metric logging around HTTP calls. Disabled by default.
   */
  enablePerformanceLogging?: boolean;
  /**
   * Provide a custom log transport (e.g., ship logs to your own logger).
   * Defaults to console.* for quick observability.
   */
  transport?: LoggerTransport;
  /**
   * Keys (case-sensitive) that should never be emitted. Defaults to common
   * credential keys to guarantee that INFO/WARN/ERROR logs stay safe.
   */
  redactKeys?: string[];
};

const DEFAULT_CONFIG: Required<Omit<LoggerConfig, "transport">> & {
  transport: LoggerTransport;
} = {
  level: "INFO",
  enableNetworkBodyLogging: false,
  enablePerformanceLogging: false,
  redactKeys: [
    "accessToken",
    "access_token",
    "clientSecret",
    "client_secret",
    "authorization",
    "Authorization",
  ],
  transport(entry) {
    const method =
      entry.level === "TRACE" || entry.level === "DEBUG"
        ? "debug"
        : entry.level === "INFO"
          ? "info"
          : entry.level === "WARN"
            ? "warn"
            : "error";
    const prefix = `[NeuronSDK][${entry.level}] ${entry.message}`;
    if (entry.context && Object.keys(entry.context).length > 0) {
      console[method]?.(prefix, entry.context);
    } else {
      console[method]?.(prefix);
    }
  },
};

const NETWORK_BODY_KEYS = new Set(["requestBody", "responseBody"]);

export class SDKLogger {
  private config: Required<LoggerConfig>;
  private levelValue: number;

  constructor() {
    this.config = {...DEFAULT_CONFIG};
    this.levelValue = this.toLevelValue(this.config.level);
  }

  /**
   * Configure the global logger.
   *
   * Development example (verbose logging + payloads):
   * ```ts
   * import {configureLogger} from "@neuronsearchlab/sdk";
   * configureLogger({
   *   level: "TRACE",
   *   enableNetworkBodyLogging: true,
   *   enablePerformanceLogging: true,
   * });
   * ```
   *
   * Production example (safe defaults):
   * ```ts
   * configureLogger({ level: "INFO" });
   * ```
   */
  public configure(config: LoggerConfig = {}) {
    this.config = {
      ...this.config,
      ...config,
      transport: config.transport ?? this.config.transport,
      redactKeys: config.redactKeys ?? this.config.redactKeys,
    };
    if (config.level !== undefined) {
      this.levelValue = this.toLevelValue(config.level);
      this.config.level = this.levelValueToName(this.levelValue);
    }
  }

  public shouldLog(level: LogLevelName): boolean {
    return this.toLevelValue(level) >= this.levelValue;
  }

  public isPerformanceLoggingEnabled(): boolean {
    return this.config.enablePerformanceLogging && this.shouldLog("DEBUG");
  }

  public canLogNetworkPayloads(level: LogLevelName): boolean {
    return (
      this.config.enableNetworkBodyLogging &&
      this.shouldLog(level) &&
      this.toLevelValue(level) <= this.toLevelValue("DEBUG")
    );
  }

  public trace(message: string, context?: Record<string, unknown>) {
    this.log("TRACE", message, context);
  }

  public debug(message: string, context?: Record<string, unknown>) {
    this.log("DEBUG", message, context);
  }

  public info(message: string, context?: Record<string, unknown>) {
    this.log("INFO", message, context);
  }

  public warn(message: string, context?: Record<string, unknown>) {
    this.log("WARN", message, context);
  }

  public error(message: string, context?: Record<string, unknown>) {
    this.log("ERROR", message, context);
  }

  public fatal(message: string, context?: Record<string, unknown>) {
    this.log("FATAL", message, context);
  }

  private log(level: LogLevelName, message: string, context?: Record<string, unknown>) {
    if (!this.shouldLog(level)) return;
    const entry: StructuredLogEntry = {
      level,
      levelValue: this.toLevelValue(level),
      message,
      timestamp: new Date().toISOString(),
      context: this.sanitizeContext(level, context),
    };
    this.config.transport(entry);
  }

  private sanitizeContext(
    level: LogLevelName,
    context?: Record<string, unknown>
  ): Record<string, unknown> | undefined {
    if (!context) return undefined;
    const sanitized: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(context)) {
      if (this.config.redactKeys.includes(key)) {
        sanitized[key] = "[REDACTED]";
        continue;
      }
      if (
        NETWORK_BODY_KEYS.has(key) &&
        !(this.canLogNetworkPayloads(level) && typeof value !== "undefined")
      ) {
        continue;
      }
      sanitized[key] = value;
    }
    return Object.keys(sanitized).length > 0 ? sanitized : undefined;
  }

  private toLevelValue(level: LogLevelName | number): number {
    if (typeof level === "number") {
      return level;
    }
    return LEVEL_VALUES[level];
  }

  private levelValueToName(value: number): LogLevelName {
    const found = (Object.entries(LEVEL_VALUES) as [LogLevelName, number][]).find(
      ([, v]) => v === value
    );
    return found?.[0] ?? "INFO";
  }
}

export const logger = new SDKLogger();
export const configureLogger = (config: LoggerConfig) => logger.configure(config);
export type {LogLevelName as LogLevel};
