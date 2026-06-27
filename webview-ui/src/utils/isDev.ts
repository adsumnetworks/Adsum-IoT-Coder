/**
 * Single source of truth for "is this a dev (F5) build?" in the webview.
 *
 * The webview's vite config injects `process.env.IS_DEV` as `JSON.stringify(process.env.IS_DEV)` — i.e. the
 * literal token `"true"` in a dev launch and `undefined` in a production build. So an exact `=== "true"`
 * comparison is the one correct check. A prior TaskHeader copy compared against `'"true"'` (embedded quotes),
 * which never matched and silently hid the dev-only download button (F4); SettingsView used a looser truthy
 * check. This helper unifies them so the gate can't drift again (F9).
 */
export const IS_DEV: boolean = process.env.IS_DEV === "true"
