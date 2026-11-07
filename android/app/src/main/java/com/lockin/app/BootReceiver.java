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
        if (!Intent.ACTION_BOOT_COMPLETED.equals(action)
                && !Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) return;

        AlarmScheduler.rescheduleAll(context);

        /* A strict session survives a reboot only if it was still live. Bring
           the room back so the web layer can restore the session and re-arm
           lock task; an expired deadline fails open like everything else. */
        BlockingStore.Config config = BlockingStore.read(context);
        if (!config.strictActive(System.currentTimeMillis())) return;
        try {
            Intent open = new Intent(context, MainActivity.class)
                    .putExtra("openRoute", "/focus")
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            context.startActivity(open);
        } catch (RuntimeException ignored) {
            /* Android can block background activity starts; the overlay still holds */
        }
    }
}
