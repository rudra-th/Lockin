package com.lockin.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/**
 * A tiny mailbox for actions taken on an alarm while the web app may not be
 * running. Tapping Start or Skip appends {@code {action, scheduleId, day, ...}}
 * here; the web bridge drains it on boot and on resume, so a skip tapped from
 * the lock screen still means the same thing as one tapped inside Lockin.
 */
public final class AlarmActions {

    private static final String PREFS = "lockin_alarm_actions";
    private static final String KEY = "pending";

    private AlarmActions() {}

    public static void push(Context context, JSONObject action) {
        if (context == null || action == null) return;
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray list = read(prefs);
        list.put(action);
        prefs.edit().putString(KEY, list.toString()).apply();
    }

    public static JSONArray consume(Context context) {
        if (context == null) return new JSONArray();
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        JSONArray list = read(prefs);
        prefs.edit().remove(KEY).apply();
        return list;
    }

    private static JSONArray read(SharedPreferences prefs) {
        try {
            return new JSONArray(prefs.getString(KEY, "[]"));
        } catch (JSONException err) {
            return new JSONArray();
        }
    }
}
