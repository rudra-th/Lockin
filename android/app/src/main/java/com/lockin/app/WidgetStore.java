package com.lockin.app;

import android.content.Context;
import android.content.SharedPreferences;

/**
 * The last glance snapshot the web app pushed. The home-screen widget and the
 * Quick Settings tile live outside the WebView, so they cannot read the store;
 * this is a copy of the numbers the screen already shows, refreshed whenever the
 * app writes. Device-local by design — nothing here is synced.
 */
final class WidgetStore {

    private static final String PREFS = "lockin_widget";

    private WidgetStore() {}

    static final class Snapshot {
        int minutes;
        int goal = 120;
        int streak;
        String next = "";
        String nextName = "";
        String nextStart = "";
        String nextEnd = "";
        String examName = "";
        int examDays = -1;
        String examWhen = "";
        int weekMinutes;
        int weekMetDays;
        boolean session;
        long until;
        long updatedAt;

        int percent() {
            if (goal <= 0) return 0;
            return Math.max(0, Math.min(100, Math.round(minutes * 100f / goal)));
        }

        boolean met() {
            return goal > 0 && minutes >= goal;
        }

        /** A running session whose fail-open end has not passed yet. */
        boolean live(long now) {
            return session && (until <= 0 || until > now);
        }
    }

    static void write(Context ctx, Snapshot snapshot) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putInt("minutes", snapshot.minutes)
                .putInt("goal", snapshot.goal)
                .putInt("streak", snapshot.streak)
                .putString("next", snapshot.next == null ? "" : snapshot.next)
                .putString("nextName", snapshot.nextName == null ? "" : snapshot.nextName)
                .putString("nextStart", snapshot.nextStart == null ? "" : snapshot.nextStart)
                .putString("nextEnd", snapshot.nextEnd == null ? "" : snapshot.nextEnd)
                .putString("examName", snapshot.examName == null ? "" : snapshot.examName)
                .putInt("examDays", snapshot.examDays)
                .putString("examWhen", snapshot.examWhen == null ? "" : snapshot.examWhen)
                .putInt("weekMinutes", snapshot.weekMinutes)
                .putInt("weekMetDays", snapshot.weekMetDays)
                .putBoolean("session", snapshot.session)
                .putLong("until", snapshot.until)
                .putLong("updatedAt", snapshot.updatedAt)
                .apply();
    }

    static Snapshot read(Context ctx) {
        SharedPreferences prefs = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        Snapshot snapshot = new Snapshot();
        snapshot.minutes = Math.max(0, prefs.getInt("minutes", 0));
        snapshot.goal = Math.max(1, prefs.getInt("goal", 120));
        snapshot.streak = Math.max(0, prefs.getInt("streak", 0));
        snapshot.next = prefs.getString("next", "");
        snapshot.nextName = prefs.getString("nextName", "");
        snapshot.nextStart = prefs.getString("nextStart", "");
        snapshot.nextEnd = prefs.getString("nextEnd", "");
        snapshot.examName = prefs.getString("examName", "");
        snapshot.examDays = prefs.getInt("examDays", -1);
        snapshot.examWhen = prefs.getString("examWhen", "");
        snapshot.weekMinutes = Math.max(0, prefs.getInt("weekMinutes", 0));
        snapshot.weekMetDays = Math.max(0, Math.min(7, prefs.getInt("weekMetDays", 0)));
        snapshot.session = prefs.getBoolean("session", false);
        snapshot.until = prefs.getLong("until", 0L);
        snapshot.updatedAt = prefs.getLong("updatedAt", 0L);
        return snapshot;
    }

    /** "1h 35m" / "45m" / "2h" — the same shape the app uses. */
    static String duration(int minutes) {
        int total = Math.max(0, minutes);
        int hours = total / 60;
        int rest = total % 60;
        if (hours == 0) return rest + "m";
        if (rest == 0) return hours + "h";
        return hours + "h " + rest + "m";
    }
}
