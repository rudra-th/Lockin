package com.lockin.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.IBinder;

import androidx.core.app.NotificationCompat;

/**
 * Keeps a strict session alive while the phone is being used.
 *
 * The web layer owns the session; this service only keeps the process warm and
 * shows a quiet, ongoing notification so Android does not treat the session as
 * idle background work. It stops the moment the session ends.
 */
public class StrictSessionService extends Service {

    private static final String CHANNEL = "lockin_strict";
    private static final int ID = 4101;
    static final String ACTION_START = "com.lockin.app.STRICT_START";
    static final String ACTION_STOP = "com.lockin.app.STRICT_STOP";

    static void start(Context context) {
        Intent intent = new Intent(context, StrictSessionService.class).setAction(ACTION_START);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
            else context.startService(intent);
        } catch (RuntimeException ignored) {
            /* Android can refuse a background start; the kiosk still holds */
        }
    }

    static void stop(Context context) {
        try {
            context.stopService(new Intent(context, StrictSessionService.class));
        } catch (RuntimeException ignored) {
            /* already stopped */
        }
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        String action = intent == null ? null : intent.getAction();
        if (ACTION_STOP.equals(action)) {
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }

        createChannel();
        startForeground(ID, notification());
        return START_STICKY;
    }

    private Notification notification() {
        Intent open = new Intent(this, MainActivity.class)
                .putExtra("openRoute", "/focus");
        PendingIntent pending = PendingIntent.getActivity(
                this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        return new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_lockin)
                .setContentTitle("Strict session running")
                .setContentText("Lockin is holding the line until you end the session.")
                .setContentIntent(pending)
                .setOngoing(true)
                .setSilent(true)
                .setPriority(NotificationCompat.PRIORITY_LOW)
                .build();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationManager manager =
                (NotificationManager) getSystemService(NOTIFICATION_SERVICE);
        if (manager == null) return;
        NotificationChannel channel = new NotificationChannel(
                CHANNEL, "Strict session", NotificationManager.IMPORTANCE_LOW);
        channel.setDescription("Shown while a strict study session is live.");
        channel.setShowBadge(false);
        manager.createNotificationChannel(channel);
    }

    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }
}
