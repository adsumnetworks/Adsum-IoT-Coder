/**
 * Single source of truth for "is this a dev (F5) build?" in the webview.
 *
 * Gotcha: vite.config injects this via the `process` object define, which **double-`JSON.stringify`s** it
 * (`process: JSON.stringify({ env: { IS_DEV: JSON.stringify(process.env.IS_DEV) } })`). The net effect is that
 * at runtime `process.env.IS_DEV` arrives as the string `"true"` *with embedded quotes* (6 chars), NOT `true`
 * — verified by simulating the define. So:
 *   - `=== '"true"'` worked (matched the embedded-quote form),
 *   - `=== "true"` did NOT (hid the dev-only download button + Settings → Debug tab),
 *   - a loose truthy check worked by accident.
 * To be robust to both the embedded-quote form and a plain `"true"` (and false when unset), strip any
 * surrounding quotes before comparing.
 */
const rawIsDev: unknown = process.env.IS_DEV
export const IS_DEV: boolean = typeof rawIsDev === "string" && rawIsDev.replace(/^"|"$/g, "") === "true"
