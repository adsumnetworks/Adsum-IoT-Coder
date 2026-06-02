/**
 * `BUILD_CONSTANTS` represent the variables that will be overwriten at build-time with predefined values.
 * Once the extension has been built, the values in this object will be fixed.
 *
 * @see [esbuild.mjs](../../esbuild.mjs)
 * @see {@link https://esbuild.github.io/api/#define|docs}
 */
export const BUILD_CONSTANTS = {
	// Adsum's own PostHog project token. When set at build time it overrides
	// the inherited Cline key, ensuring fork users' events land in Adsum's
	// analytics rather than upstream's.
	ADSUM_TELEMETRY_SERVICE_API_KEY: process.env.ADSUM_TELEMETRY_SERVICE_API_KEY,
	TELEMETRY_SERVICE_API_KEY: process.env.TELEMETRY_SERVICE_API_KEY,
	ERROR_SERVICE_API_KEY: process.env.ERROR_SERVICE_API_KEY,
	OTEL_TELEMETRY_ENABLED: process.env.OTEL_TELEMETRY_ENABLED,
	OTEL_METRICS_EXPORTER: process.env.OTEL_METRICS_EXPORTER,
	OTEL_LOGS_EXPORTER: process.env.OTEL_LOGS_EXPORTER,
	OTEL_EXPORTER_OTLP_PROTOCOL: process.env.OTEL_EXPORTER_OTLP_PROTOCOL,
	OTEL_EXPORTER_OTLP_ENDPOINT: process.env.OTEL_EXPORTER_OTLP_ENDPOINT,
	OTEL_EXPORTER_OTLP_HEADERS: process.env.OTEL_EXPORTER_OTLP_HEADERS,
	OTEL_METRIC_EXPORT_INTERVAL: process.env.OTEL_METRIC_EXPORT_INTERVAL,
}
