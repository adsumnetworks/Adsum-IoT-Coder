# Pattern: Embedded Static Web Content in C Strings

## Overview
ESP32 projects often embed HTML/CSS/JavaScript directly in C strings to serve web dashboards without a filesystem. This requires careful quote escaping and string concatenation to avoid compilation errors. This pattern applies to any embedded web UI: sensor dashboards, device configuration interfaces, control panels, status pages.

**Applicability:** HTTP servers (esp_http_server), REST APIs that return HTML, device web UIs, embedded status displays.

## Critical Rules

### Rule 1: Every Concatenated Line Must End with `\n"`

String continuation across multiple lines requires explicit newline (`\n`) at the end of each line PLUS terminating quote. Without it, the compiler sees unterminated strings.

❌ **WRONG** — Missing newlines cause "unterminated string" errors:
```c
const char *html = "<!DOCTYPE html>"
    "<body>"
    "<h1>Test</h1>";
    // ^ Compiler error: each line must end with \n"
```

✅ **CORRECT** — Every line ends with `\n"`:
```c
const char *html =
    "<!DOCTYPE html>\n"
    "<html>\n"
    "<body>\n"
    "<h1>Test</h1>\n"
    "</body>\n"
    "</html>\n";
```

### Rule 2: Quote Nesting — Prefer Single Quotes in HTML Attributes

When embedding HTML inside C double-quoted strings, use single quotes in HTML to avoid escaping nightmares:

❌ **WRONG** — Double-quote escaping everywhere:
```c
"<div class=\"widget\" id=\"temp\">Value</div>"
"<script>document.querySelector(\"#temp\").textContent = \"25.5\";</script>"
// ^ Hard to read; easy to miss an escape
```

✅ **CORRECT** — Single quotes in HTML, double in JavaScript:
```c
"<div class='widget' id='temp'>Value</div>\n"
"<script>\n"
"document.querySelector('#temp').textContent = \"25.5\";\n"
"</script>\n"
```

**Rule of thumb:** 
- C string uses `"..."` (double)
- HTML attributes use `'...'` (single)  
- JavaScript inside `<script>` uses `"..."` (double) — clear separation

### Rule 3: Extract Complex Styles and Scripts to `<style>` and `<script>` Blocks

Don't inline styles or scripts with complex escaping. Use dedicated blocks:

❌ **WRONG** — Inline style with multiple quote levels:
```c
"<div style=\"background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: rgba(255,255,255,0.9);\">...</div>"
// Very hard to parse; high error risk
```

✅ **CORRECT** — Define in `<style>` block:
```c
"<style>\n"
".hero { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: rgba(255,255,255,0.9); }\n"
"</style>\n"
"<div class='hero'>...</div>\n"
```

### Rule 3: Avoid Inline Styles — Use CSS Classes
Inline `style=` attributes combine HTML attributes, CSS, and C escaping. Extract to `<style>` block:

❌ **WRONG** — Too many quote layers:
```c
"<div style=\"background: rgba(12, 18, 35, 0.95); border: 1px solid rgba(255,255,255,0.08);\">...</div>"
```

✅ **CORRECT** — Define in CSS, apply via class:
```c
"<style>\n"
".card { background: rgba(12, 18, 35, 0.95); border: 1px solid rgba(255,255,255,0.08); }\n"
"</style>\n"
"<div class='card'>...</div>"
```

## Complete Template for HTTP Handler

Use this structure for any embedded HTML response:

```c
static esp_err_t root_get_handler(httpd_req_t *req)
{
    // Define entire HTML/CSS/JS in one const char* with proper line endings
    const char *html =
        "<!DOCTYPE html>\n"
        "<html lang='en'>\n"
        "<head>\n"
        "<meta charset=\"UTF-8\">\n"
        "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1.0\">\n"
        "<title>My Dashboard</title>\n"
        "<style>\n"
        "body { margin: 0; font-family: sans-serif; background: #0a0e27; color: #e7edf8; }\n"
        ".container { max-width: 920px; margin: 0 auto; padding: 20px; }\n"
        ".card { background: rgba(12, 18, 35, 0.95); border-radius: 8px; padding: 20px; }\n"
        "</style>\n"
        "</head>\n"
        "<body>\n"
        "<div class='container'>\n"
        "<div class='card'>\n"
        "<h1>My Dashboard</h1>\n"
        "<div id='sensor-value'>Loading...</div>\n"
        "</div>\n"
        "</div>\n"
        "<script>\n"
        "async function fetchData() {\n"
        "  try {\n"
        "    const response = await fetch('/api/data');\n"
        "    const data = await response.json();\n"
        "    document.getElementById('sensor-value').textContent = data.value;\n"
        "  } catch (error) {\n"
        "    console.error('Fetch failed:', error);\n"
        "  }\n"
        "}\n"
        "setInterval(fetchData, 3000);\n"
        "fetchData();\n"
        "</script>\n"
        "</body>\n"
        "</html>\n";

    httpd_resp_set_type(req, "text/html");
    httpd_resp_send(req, html, strlen(html));
    return ESP_OK;
}
```

## Key Takeaways

| Pattern | Use When | Example |
|---------|----------|---------|
| Single quotes in HTML | Inside C double-quote string | `"<div class='card'>..."` |
| `\n` at end of each line | Readability and preventing quote errors | `"<div>\n"` |
| Inline JSON in JavaScript | Wrap in double quotes | `{\"temp\": 25.5, \"unit\": \"C\"}` |
| Complex CSS | Extract to `<style>` block | `"<style>\n.card { ... }\n</style>\n"` |
| Data binding | Use JavaScript `fetch()` and `textContent` | `document.getElementById('id').textContent = value;` |

## Debugging Quote Errors

If the compiler says "error: missing terminating `"` character":

1. Check each concatenated string line ends with `\n"`
2. Verify all `{`, `[`, `(` have matching closing pairs within that line
3. Use your editor's bracket matching (Ctrl+Shift+\\ in VS Code)
4. Test the string in isolation:

```c
static const char test[] = "your problematic string here";
```

If it compiles standalone, the issue is in adjacent lines.

## Best Practices

- **Keep lines under 120 characters** for readability
- **Test incrementally** — build after adding each section
- **Use comments** to mark major sections:
  ```c
  "<!-- HEADER SECTION -->\n"
  "<header>...</header>\n"
  "<!-- SENSOR CARDS -->\n"
  "<div class='sensors'>...</div>\n"
  ```
- **Avoid very long lines** — split CSS and JavaScript into multiple lines with `\n"`

