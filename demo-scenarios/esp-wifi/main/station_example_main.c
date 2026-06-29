/* Wi-Fi station — "connected but offline" demo
 *
 * A real, subtle ESP-IDF Wi-Fi bug: the app starts using the network as soon as the
 * link is up (WIFI_EVENT_STA_CONNECTED) instead of waiting for an actual IP address
 * (IP_EVENT_STA_GOT_IP). The radio associates, the log says "connected" — but DHCP
 * hasn't finished, so there is no IP yet and the first DNS lookup fails. Classic.
 */
#include <string.h>
#include "freertos/FreeRTOS.h"
#include "freertos/task.h"
#include "freertos/event_groups.h"
#include "esp_system.h"
#include "esp_wifi.h"
#include "esp_event.h"
#include "esp_log.h"
#include "esp_netif.h"
#include "nvs_flash.h"

#include "lwip/err.h"
#include "lwip/sys.h"
#include "lwip/netdb.h"

#define EXAMPLE_ESP_WIFI_SSID      CONFIG_ESP_WIFI_SSID
#define EXAMPLE_ESP_WIFI_PASS      CONFIG_ESP_WIFI_PASSWORD
#define EXAMPLE_ESP_MAXIMUM_RETRY  CONFIG_ESP_MAXIMUM_RETRY

/* ── The bug switch ──────────────────────────────────────────────────────────────
 * DEMO_BUG = 1 : signal "network ready" on WIFI_EVENT_STA_CONNECTED (link up, NO IP yet) — the bug.
 * DEMO_BUG = 0 : signal "network ready" on IP_EVENT_STA_GOT_IP (IP assigned) — the fix.
 * The shipped demo source has the bug present (= 1); the fix is the one-line event swap. */
#ifndef DEMO_BUG
#define DEMO_BUG 1
#endif

#define ESP_WIFI_SCAN_AUTH_MODE_THRESHOLD WIFI_AUTH_WPA2_PSK

#define WIFI_READY_BIT  BIT0   /* set when we believe the network is usable */
#define WIFI_FAIL_BIT   BIT1

static EventGroupHandle_t s_wifi_event_group;
static const char *TAG = "wifi_station";
static int s_retry_num = 0;

static void event_handler(void *arg, esp_event_base_t event_base,
                          int32_t event_id, void *event_data)
{
    if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_START) {
        esp_wifi_connect();
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_DISCONNECTED) {
        if (s_retry_num < EXAMPLE_ESP_MAXIMUM_RETRY) {
            esp_wifi_connect();
            s_retry_num++;
            ESP_LOGI(TAG, "retry to connect to the AP");
        } else {
            xEventGroupSetBits(s_wifi_event_group, WIFI_FAIL_BIT);
        }
        ESP_LOGI(TAG, "connect to the AP fail");
    } else if (event_base == WIFI_EVENT && event_id == WIFI_EVENT_STA_CONNECTED) {
        ESP_LOGI(TAG, "STA_CONNECTED — link up (association complete)");
#if DEMO_BUG
        /* BUG: the link is up but DHCP has NOT run yet — we have NO IP. Proceeding to use
         * the network here is too early. The fix is to wait for IP_EVENT_STA_GOT_IP. */
        xEventGroupSetBits(s_wifi_event_group, WIFI_READY_BIT);
#endif
    } else if (event_base == IP_EVENT && event_id == IP_EVENT_STA_GOT_IP) {
        ip_event_got_ip_t *event = (ip_event_got_ip_t *) event_data;
        ESP_LOGI(TAG, "got ip:" IPSTR, IP2STR(&event->ip_info.ip));
        s_retry_num = 0;
#if !DEMO_BUG
        xEventGroupSetBits(s_wifi_event_group, WIFI_READY_BIT);
#endif
    }
}

/* The first thing the app does once it thinks the network is up: resolve a hostname.
 * With the bug this runs before we have an IP, so DNS fails — "connected" but offline. */
static void check_connectivity(void)
{
    const char *host = "pool.ntp.org";
    ESP_LOGI(TAG, "network ready — resolving %s ...", host);

    struct addrinfo hints = { .ai_family = AF_INET, .ai_socktype = SOCK_STREAM };
    struct addrinfo *res = NULL;
    int err = getaddrinfo(host, "123", &hints, &res);
    if (err != 0 || res == NULL) {
        ESP_LOGE(TAG, "DNS lookup failed for %s (err=%d) — we are 'connected' but have no usable IP yet", host, err);
        ESP_LOGE(TAG, "the radio associated, but DHCP had not assigned an address when we tried to use the network");
        return;
    }
    struct in_addr *addr = &((struct sockaddr_in *) res->ai_addr)->sin_addr;
    ESP_LOGI(TAG, "resolved %s -> %s  (network is actually online)", host, inet_ntoa(*addr));
    freeaddrinfo(res);
}

static void wifi_init_sta(void)
{
    s_wifi_event_group = xEventGroupCreate();

    ESP_ERROR_CHECK(esp_netif_init());
    ESP_ERROR_CHECK(esp_event_loop_create_default());
    esp_netif_create_default_wifi_sta();

    wifi_init_config_t cfg = WIFI_INIT_CONFIG_DEFAULT();
    ESP_ERROR_CHECK(esp_wifi_init(&cfg));

    esp_event_handler_instance_t instance_any_id;
    esp_event_handler_instance_t instance_got_ip;
    ESP_ERROR_CHECK(esp_event_handler_instance_register(WIFI_EVENT, ESP_EVENT_ANY_ID,
                                                        &event_handler, NULL, &instance_any_id));
    ESP_ERROR_CHECK(esp_event_handler_instance_register(IP_EVENT, IP_EVENT_STA_GOT_IP,
                                                        &event_handler, NULL, &instance_got_ip));

    wifi_config_t wifi_config = {
        .sta = {
            .ssid = EXAMPLE_ESP_WIFI_SSID,
            .password = EXAMPLE_ESP_WIFI_PASS,
            .threshold.authmode = ESP_WIFI_SCAN_AUTH_MODE_THRESHOLD,
        },
    };
    ESP_ERROR_CHECK(esp_wifi_set_mode(WIFI_MODE_STA));
    ESP_ERROR_CHECK(esp_wifi_set_config(WIFI_IF_STA, &wifi_config));
    ESP_ERROR_CHECK(esp_wifi_start());

    ESP_LOGI(TAG, "wifi_init_sta finished.");

    EventBits_t bits = xEventGroupWaitBits(s_wifi_event_group,
                                           WIFI_READY_BIT | WIFI_FAIL_BIT,
                                           pdFALSE, pdFALSE, portMAX_DELAY);

    if (bits & WIFI_READY_BIT) {
        ESP_LOGI(TAG, "connected to AP SSID:%s", EXAMPLE_ESP_WIFI_SSID);
        check_connectivity();
    } else if (bits & WIFI_FAIL_BIT) {
        ESP_LOGI(TAG, "Failed to connect to SSID:%s", EXAMPLE_ESP_WIFI_SSID);
    } else {
        ESP_LOGE(TAG, "UNEXPECTED EVENT");
    }
}

void app_main(void)
{
    esp_err_t ret = nvs_flash_init();
    if (ret == ESP_ERR_NVS_NO_FREE_PAGES || ret == ESP_ERR_NVS_NEW_VERSION_FOUND) {
        ESP_ERROR_CHECK(nvs_flash_erase());
        ret = nvs_flash_init();
    }
    ESP_ERROR_CHECK(ret);

    ESP_LOGI(TAG, "ESP_WIFI_MODE_STA");
    wifi_init_sta();
}
