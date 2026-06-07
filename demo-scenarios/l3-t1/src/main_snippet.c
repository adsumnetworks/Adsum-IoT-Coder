/*
 * central/src/main.c — discovery_complete callback (excerpt)
 *
 * Called after GATT service discovery finishes.
 * Stores handles for NUS TX (peripheral→central) and RX (central→peripheral).
 */
static uint8_t discovery_complete(struct bt_gatt_dm *dm, void *ctx)
{
    const struct bt_gatt_dm_attr *attr;
    int err;

    LOG_INF("Discovery complete");

    /* Locate NUS TX characteristic (peripheral sends on this) */
    attr = bt_gatt_dm_char_by_uuid(dm, BT_UUID_NUS_TX);
    if (!attr) {
        LOG_ERR("NUS TX characteristic not found");
        return BT_GATT_ITER_STOP;
    }
    nus_handles.tx = bt_gatt_dm_attr_chrc_val(attr)->handle;

    /* Locate NUS RX characteristic (central writes on this) */
    attr = bt_gatt_dm_char_by_uuid(dm, BT_UUID_NUS_RX);
    if (!attr) {
        LOG_ERR("NUS RX characteristic not found");
        return BT_GATT_ITER_STOP;
    }
    nus_handles.rx = bt_gatt_dm_attr_chrc_val(attr)->handle;

    /* NOTE: subscription to TX notifications is intentionally omitted here */

    err = bt_gatt_dm_data_release(dm);
    if (err) {
        LOG_ERR("Failed to release discovery data: %d", err);
    }

    k_sem_give(&gatt_discovery_done);
    return BT_GATT_ITER_STOP;
}
