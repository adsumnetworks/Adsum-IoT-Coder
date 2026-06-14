# Protocol: Wi-Fi & Webserver (sdks/esp-idf/protocols/WIFI.md)

This file documents the mandatory initialization sequence and best practices for creating a Wi-Fi connection and an HTTP server in ESP-IDF v5.5.

## Wi-Fi Initialization Sequence (MANDATORY)

To use Wi-Fi, you MUST initialize several core systems in this exact order in `app_main()`:

1. **NVS (Non-Volatile Storage) Initialization:** Required for storing Wi-Fi calibration data and saved credentials.
   ```c
   esp_err_t ret = nvs_flash_init();
   if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
       ESP_ERROR_CHECK(nvs_flash_erase());
       ret = nvs_flash_init();
   }
   ESP_ERROR_CHECK(ret);
   ```

2. **Network Interface Initialization:** Required for LwIP.
   ```c
   ESP_ERROR_CHECK(esp_netif_init());
   ```

3. **Event Loop Initialization:** Required for Wi-Fi state machines.
   ```c
   ESP_ERROR_CHECK(esp_event_loop_create_default());
   ```

4. **Wi-Fi Subsystem Initialization:**
   ```c
   esp_netif_t *ap_netif = esp_netif_create_default_wifi_ap(); // If AP
   // or
   esp_netif_t *sta_netif = esp_netif_create_default_wifi_sta(); // If Station
   
   wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
   ESP_ERROR_CHECK(esp_wifi_init(&cfg));
   ```

## Event Handlers

Wi-Fi connections are asynchronous. You must attach an event handler to listen for `WIFI_EVENT` (like `WIFI_EVENT_STA_START`, `WIFI_EVENT_STA_DISCONNECTED`) and `IP_EVENT` (like `IP_EVENT_STA_GOT_IP`).

- When `WIFI_EVENT_STA_START` fires, call `esp_wifi_connect()`.
- When `WIFI_EVENT_STA_DISCONNECTED` fires, check retry logic, and call `esp_wifi_connect()` again to keep trying.
- When `IP_EVENT_STA_GOT_IP` fires, the network is ready. Start your webserver / MQTT tasks here.

## HTTP Server (`esp_http_server.h`)

ESP-IDF includes `esp_http_server` to serve endpoints.

1. **Start the server:** Use `httpd_start(&server, &config)` after acquiring an IP address.
2. **Register URIs:** Use `httpd_register_uri_handler(server, &uri_config)`.
3. **Chunked Responses:** For serving large HTML strings (the embedded-page recipe in
   `workflows/add-feature.md`), you CANNOT send them as one massive chunk if they exceed the HTTPD
   buffer. Use chunked transfer encoding `httpd_resp_send_chunk(req, buf, len)` in a loop, followed by
   `httpd_resp_send_chunk(req, NULL, 0)` to finish.

**Example URI Config:**
```c
httpd_uri_t uri_get = {
    .uri      = "/",
    .method   = HTTP_GET,
    .handler  = root_get_handler,
    .user_ctx = NULL
};
```
