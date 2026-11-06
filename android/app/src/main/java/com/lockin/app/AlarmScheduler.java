package com.lockin.app;

import android.app.AlarmManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Build;
import android.util.Log;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * Stores the next window of schedule alarms and hands them to AlarmManager.
 * The web app computes the events; this class only knows how to ring them.
 */
public final class AlarmScheduler {

    private static final String PREFS = "lockin_alarms";
    private static final String KEY = "scheduled";
    private static final String ACTION = "com.lockin.app.SCHEDULE_ALARM";
    private static final String TAG = "LockinAlarms";

    private AlarmScheduler() {}

    public static boolean canScheduleExact(Context context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return true;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        return am != null && am.canScheduleExactAlarms();
    }

    /** Replace the stored window with a fresh list. Past alarms are dropped. */
    public static int sync(Context context, JSONArray alarms) {
        cancelAll(context);
        JSONArray kept = new JSONArray();
        long now = System.currentTimeMillis();

        for (int i = 0; i < alarms.length(); i++) {
            JSONObject alarm = alarms.optJSONObject(i);
            if (alarm == null) continue;
            long at = alarm.optLong("at", 0L);
            if (at <= now) continue;
            if (schedule(context, alarm)) kept.put(alarm);
        }

        prefs(context).edit().putString(KEY, kept.toString()).apply();
        return kept.length();
    }

    public static void rescheduleAll(Context context) {
        String raw = prefs(context).getString(KEY, "[]");
        try {
            sync(context, new JSONArray(raw));
        } catch (JSONException err) {
            Log.w(TAG, "stored alarm list is not valid JSON", err);
        }
    }

    public static void cancelAll(Context context) {
        String raw = prefs(context).getString(KEY, "[]");
        try {
            JSONArray alarms = new JSONArray(raw);
            for (int i = 0; i < alarms.length(); i++) {
                JSONObject alarm = alarms.optJSONObject(i);
                if (alarm != null) cancel(context, alarm.optString("id", ""));
            }
        } catch (JSONException ignored) {
            /* nothing to cancel */
        }
        prefs(context).edit().remove(KEY).apply();
    }

    private static boolean schedule(Context context, JSONObject alarm) {
        String id = alarm.optString("id", "");
        long at = alarm.optLong("at", 0L);
        if (id.isEmpty() || at <= 0) return false;

        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return false;

        PendingIntent pending = pendingIntent(context, alarm,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        try {
            if (canScheduleExact(context)) {
                am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
            return true;
        } catch (SecurityException err) {
            /* The OS can revoke exact alarms at any time; keep the reminder. */
            am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            return true;
        }
    }

    private static void cancel(Context context, String id) {
        if (id.isEmpty()) return;
        AlarmManager am = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (am == null) return;

        PendingIntent pending = PendingIntent.getBroadcast(
                context,
                id.hashCode(),
                baseIntent(context, id),
                PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pending != null) {
            am.cancel(pending);
            pending.cancel();
        }
    }

    private static PendingIntent pendingIntent(Context context, JSONObject alarm, int flags) {
        String id = alarm.optString("id", "");
        Intent intent = baseIntent(context, id);
        intent.putExtra("id", id);
        intent.putExtra("title", alarm.optString("title", "Lockin"));
        intent.putExtra("body", alarm.optString("body", ""));
        intent.putExtra("kind", alarm.optString("kind", "start"));
        putActionExtras(intent, alarm);
        return PendingIntent.getBroadcast(context, id.hashCode(), intent, flags);
    }

    /** The schedule identity travels with the alarm so Start/Skip can act. */
    static void putActionExtras(Intent intent, JSONObject alarm) {
        intent.putExtra("scheduleId", alarm.optString("scheduleId", ""));
        intent.putExtra("day", alarm.optString("day", ""));
        intent.putExtra("name", alarm.optString("name", alarm.optString("title", "Lockin")));
        intent.putExtra("startAt", alarm.optLong("start", 0L));
        intent.putExtra("endAt", alarm.optLong("end", 0L));
    }

    private static Intent baseIntent(Context context, String id) {
        Intent intent = new Intent(context, AlarmReceiver.class);
        intent.setAction(ACTION);
        intent.setData(Uri.parse("lockin://alarm/" + Uri.encode(id)));
        return intent;
    }

    private static SharedPreferences prefs(Context context) {
        return context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }
}
