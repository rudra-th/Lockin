package com.lockin.app;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Re-seeds the next alarm window after a reboot or an app update. */
public class BootReceiver extends BroadcastReceiver {

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action)
                || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            AlarmScheduler.rescheduleAll(context);
        }
    }
}
