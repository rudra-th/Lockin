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
import android.net.Uri;
import android.os.Build;

import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;
import androidx.core.content.ContextCompat;

import org.json.JSONException;
import org.json.JSONObject;

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

        /* Skip tapped from the notification: no app launch, just remember it
           for the next time the web bridge drains the queue. */
        if ("skip".equals(intent.getStringExtra("alarmAction"))) {
            pushAction(context, intent, "skip");
            NotificationManagerCompat.from(context).cancel(id.hashCode());
            return;
        }

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
            copyActionExtras(intent, alarm);
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

        /* Start and Skip live on the notification itself, so the block can be
           taken or dismissed without unlocking first. Reminders stay quiet. */
        if (!reminder) {
            Intent startIntent = new Intent(context, MainActivity.class);
            startIntent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            startIntent.setData(Uri.parse("lockin://alarm-start/" + Uri.encode(id)));
            startIntent.putExtra("alarmAction", "start");
            copyActionExtras(intent, startIntent);
            PendingIntent start = PendingIntent.getActivity(
                    context,
                    id.hashCode() + 2000,
                    startIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            Intent skipIntent = new Intent(context, AlarmReceiver.class);
            skipIntent.setAction("com.lockin.app.SCHEDULE_ALARM");
            skipIntent.setData(Uri.parse("lockin://alarm-skip/" + Uri.encode(id)));
            skipIntent.putExtra("id", id);
            skipIntent.putExtra("alarmAction", "skip");
            copyActionExtras(intent, skipIntent);
            PendingIntent skip = PendingIntent.getBroadcast(
                    context,
                    id.hashCode() + 3000,
                    skipIntent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

            builder.addAction(0, context.getString(R.string.alarm_start), start);
            builder.addAction(0, context.getString(R.string.alarm_skip), skip);
        }

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

    /** Copy the schedule identity from a ring intent onto an action intent. */
    private static void copyActionExtras(Intent from, Intent to) {
        to.putExtra("scheduleId", from.getStringExtra("scheduleId"));
        to.putExtra("day", from.getStringExtra("day"));
        to.putExtra("name", from.getStringExtra("name"));
        to.putExtra("startAt", from.getLongExtra("startAt", 0L));
        to.putExtra("endAt", from.getLongExtra("endAt", 0L));
    }

    /** Remember a lock-screen action for the web bridge to pick up. */
    static void pushAction(Context context, Intent intent, String action) {
        JSONObject row = new JSONObject();
        try {
            row.put("action", action);
            row.put("scheduleId", intent.getStringExtra("scheduleId"));
            row.put("day", intent.getStringExtra("day"));
            row.put("name", intent.getStringExtra("name"));
            row.put("startAt", intent.getLongExtra("startAt", 0L));
            row.put("endAt", intent.getLongExtra("endAt", 0L));
        } catch (JSONException ignored) {
            return;
        }
        AlarmActions.push(context, row);
    }

    private void createChannels(Context context) {        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
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
