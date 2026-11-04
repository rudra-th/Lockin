package com.lockin.app;

import android.Manifest;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.media.AudioAttributes;
import android.media.RingtoneManager;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

/**
 * Receives an exact schedule alarm and posts a high-priority notification.
 * A start alarm also asks for a full-screen intent when the OS allows it
 * (Android 14+ exposes that decision at runtime); if it is denied, the same
 * notification still arrives as a heads-up alert.
 */
public class AlarmReceiver extends BroadcastReceiver {

    public static final String CHANNEL_ALARM = "lockin-alarms";
    public static final String CHANNEL_REMIND = "lockin-reminders";

    /** Android 14+ can withhold full-screen intents; older versions allow them. */
    public static boolean canUseFullScreen(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.UPSIDE_DOWN_CAKE) return true;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        return manager != null && manager.canUseFullScreenIntent();
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (intent == null) return;

        String id = intent.getStringExtra("id");
        if (id == null) id = "lockin-alarm";
        String title = intent.getStringExtra("title");
        if (title == null || title.isEmpty()) title = "Lockin";
        String body = intent.getStringExtra("body");
        if (body == null) body = "";
        String kind = intent.getStringExtra("kind");
        boolean reminder = "remind".equals(kind);

        createChannels(context);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU
                && ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS)
                != PackageManager.PERMISSION_GRANTED) {
            return;
        }

        Intent open = new Intent(context, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("openSchedule", true);

        PendingIntent content = PendingIntent.getActivity(
                context,
                0,
                open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        /* Start alarms may take the lock screen. Android 14+ can deny that at
           runtime; when it does, this stays an ordinary (still loud) heads-up. */
        PendingIntent fullScreen = null;
        if (!reminder && canUseFullScreen(context)) {
            Intent alarm = new Intent(context, AlarmActivity.class);
            alarm.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            alarm.putExtra("id", id);
            alarm.putExtra("title", title);
            alarm.putExtra("body", body);
            fullScreen = PendingIntent.getActivity(
                    context,
                    id.hashCode() + 1000,
                    alarm,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }

        NotificationCompat.Builder builder = new NotificationCompat.Builder(
                context, reminder ? CHANNEL_REMIND : CHANNEL_ALARM)
                .setSmallIcon(R.drawable.ic_stat_lockin)
                .setColor(0xFFC6F24E)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setPriority(reminder ? NotificationCompat.PRIORITY_DEFAULT : NotificationCompat.PRIORITY_MAX)
                .setCategory(reminder ? NotificationCompat.CATEGORY_REMINDER : NotificationCompat.CATEGORY_ALARM)
                .setAutoCancel(true)
                .setContentIntent(content)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);

        if (fullScreen != null) builder.setFullScreenIntent(fullScreen, true);

        /* Pre-O ignores channels, so the alarm needs its own sound/vibration. */
        if (!reminder) {
            builder.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM))
                    .setVibrate(new long[] { 0, 180, 80, 180, 80, 260 });
        }

        try {
            NotificationManagerCompat.from(context).notify(id.hashCode(), builder.build());
        } catch (SecurityException ignored) {
            /* The user can revoke notifications at any time. */
        }
    }

    private void createChannels(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null) return;

        NotificationChannel alarms = new NotificationChannel(
                CHANNEL_ALARM,
                context.getString(R.string.channel_alarms),
                NotificationManager.IMPORTANCE_HIGH);
        alarms.setDescription(context.getString(R.string.channel_alarms_desc));
        alarms.enableVibration(true);
        alarms.setVibrationPattern(new long[] { 180, 80, 180, 80, 260 });
        AudioAttributes alarmSound = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        alarms.setSound(RingtoneManager.getDefaultUri(RingtoneManager.TYPE_ALARM), alarmSound);

        NotificationChannel reminders = new NotificationChannel(
                CHANNEL_REMIND,
                context.getString(R.string.channel_reminders),
                NotificationManager.IMPORTANCE_DEFAULT);
        reminders.setDescription(context.getString(R.string.channel_reminders_desc));
        reminders.enableVibration(true);
        reminders.setVibrationPattern(new long[] { 120 });

        manager.createNotificationChannel(alarms);
        manager.createNotificationChannel(reminders);
    }
}
