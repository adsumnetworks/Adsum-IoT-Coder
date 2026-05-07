# Action: Web Dashboard Development (actions/web-dashboard-dev.md)

## When Used
Called when developing HTML/JS/CSS web frontends meant to be hosted natively on an ESP32 webserver.

## The Microcontroller Frontend Paradigm
Serving a website from an ESP32 is vastly different from serving one from AWS. Resources are severely constrained.
- **Goal:** Minimal footprint, standalone capability, and real-time responsiveness without full page reloads.

## Best Practices

### 1. Delivery Format (C-Strings)
The most foolproof method for serving HTML on ESP32 without relying on file systems (SPIFFS/LittleFS) is to bake the HTML directly into the C firmware as a `PROGMEM` string.

**Pattern:**
Create a separate header file (e.g., `webpage.h`) and Define the HTML:
```c
// webpage.h
#pragma once
const char* root_html = R"=====(
<!DOCTYPE html>
<html>
<head>
    <title>ESP Dash</title>
    <!-- CSS and JS Go Here -->
</head>
<body>
    <h1 id="temp">-- °C</h1>
</body>
</html>
)=====";
```

### 2. Single-Page Application (Vanilla JS/CSS)
Do not use React, Vue, or heavy frameworks. Use Vanilla JS. Embed CSS and JS directly inside the `<style>` and `<script>` tags of your single `index.html` string to avoid multiple HTTP requests, which strain the ESP32 network stack.

### 3. Dependency Management (No CDNs if offline)
If the device is forming its own Wi-Fi Access Point (AP), it will NOT have internet access.
- **Rule:** Do NOT use external CDNs (e.g., `<link href="https://cdnjs.cloudflare.com/...>`) unless you explicitly know the device operates on a network with external internet access.
- Write your own minimal CSS.

### 4. Asynchronous Updates (Fetch API)
Do not require the user to refresh the page to see new sensor data.
- The ESP32 handles concurrent heavy requests poorly. Instead of refreshing the massive `index.html`, fetch lightweight JSON data periodically.

**Frontend (JS):**
```javascript
setInterval(() => {
    fetch('/api/data')
        .then(response => response.json())
        .then(data => {
            document.getElementById('temp').innerText = data.temperature + " °C";
        });
}, 2000);
```

**Backend (ESP-IDF C):**
```c
esp_err_t api_data_handler(httpd_req_t *req) {
    char buf[100];
    snprintf(buf, sizeof(buf), "{\"temperature\": %.2f}", read_dht11());
    httpd_resp_set_type(req, "application/json");
    return httpd_resp_send(req, buf, strlen(buf));
}
```

### 5. Memory Management (Chunked Delivery)
If your `index.html` string exceeds ~4KB, you might encounter issues returning it in one pass depending on HTTPD settings. Use chunked transfer encoding (see `WIFI.md`) to stream the C-string pointer in smaller chunks.
