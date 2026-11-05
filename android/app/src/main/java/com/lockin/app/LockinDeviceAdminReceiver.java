package com.lockin.app;

import android.app.admin.DeviceAdminReceiver;

/**
 * The admin component behind strict study mode.
 *
 * A plain app cannot stop Android's Home, Recents or notification shade. A
 * device owner can: Lockin becomes the device owner once, through a one-time
 * `adb shell dpm set-device-owner` command, and then a strict session can use
 * lock task mode with a real allowlist. Without device ownership the receiver
 * is inert and strict mode falls back to screen pinning, which Android always
 * lets the user unpin.
 *
 * Lockin requests no device policies — no wipe, no password, no camera.
 */
public class LockinDeviceAdminReceiver extends DeviceAdminReceiver {
}
