package com.lockin.app;

import android.Manifest;
import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;

import androidx.core.app.NotificationManagerCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * The only native surface the web app talks to. It owns exact alarms,
 * usage access and notification permission. No UI lives here.
 */
@CapacitorPlugin(
        name = "LockinNative",
        permissions = {
                @Permission(alias = "notifications", strings = { Manifest.permission.POST_NOTIFICATIONS })
        }
)
public class LockinNativePlugin extends Plugin {

    /* ---------- shell ---------- */

    /** A notification tap may have asked for Schedule before the web booted. */
    @PluginMethod
    public void consumeRoute(PluginCall call) {
        JSObject result = new JSObject();
        result.put("route", MainActivity.consumeRoute());
        call.resolve(result);
    }

    /* ---------- alarms ---------- */

    @PluginMethod
    public void syncAlarms(PluginCall call) {
        JSArray input = call.getArray("alarms");
        JSONArray alarms = new JSONArray();

        if (input != null) {
            List<Object> items;
            try {
                items = input.toList();
            } catch (JSONException err) {
                items = new ArrayList<>();
            }
            for (Object raw : items) {
                if (!(raw instanceof JSObject)) continue;
                JSObject item = (JSObject) raw;
                JSONObject alarm = new JSONObject();
                try {
                    alarm.put("id", item.getString("id", ""));
                    alarm.put("at", item.optLong("at", 0L));
                    alarm.put("title", item.getString("title", "Lockin"));
                    alarm.put("body", item.getString("body", ""));
                    alarm.put("kind", item.getString("kind", "start"));
                    alarms.put(alarm);
                } catch (Exception ignored) {
                    /* skip a malformed alarm, keep the rest */
                }
            }
        }

        int scheduled = AlarmScheduler.sync(getContext(), alarms);
        JSObject result = new JSObject();
        result.put("scheduled", scheduled);
        result.put("exact", AlarmScheduler.canScheduleExact(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void cancelAllAlarms(PluginCall call) {
        AlarmScheduler.cancelAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void canScheduleExactAlarms(PluginCall call) {
        JSObject result = new JSObject();
        result.put("exact", AlarmScheduler.canScheduleExact(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void openExactAlarmSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            intent = new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                    Uri.parse("package:" + getContext().getPackageName()));
        } else {
            intent = appDetailsIntent();
        }
        open(intent);
        call.resolve();
    }

    /* ---------- notifications ---------- */

    @PluginMethod
    public void notificationPermission(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", NotificationManagerCompat.from(getContext()).areNotificationsEnabled());
        call.resolve(result);
    }

    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            call.resolve();
            return;
        }
        if (getPermissionState("notifications") == PermissionState.GRANTED) {
            call.resolve();
            return;
        }
        requestPermissionForAlias("notifications", call, "notificationsCallback");
    }

    @PermissionCallback
    private void notificationsCallback(PluginCall call) {
        call.resolve();
    }

    @PluginMethod
    public void openNotificationSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                    .putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
        } else {
            intent = appDetailsIntent();
        }
        open(intent);
        call.resolve();
    }

    /* ---------- usage access ---------- */

    @PluginMethod
    public void hasUsageAccess(PluginCall call) {
        JSObject result = new JSObject();
        result.put("granted", usageAccessGranted());
        call.resolve(result);
    }

    @PluginMethod
    public void openUsageAccessSettings(PluginCall call) {
        open(new Intent(Settings.ACTION_USAGE_ACCESS_SETTINGS));
        call.resolve();
    }

    @PluginMethod
    public void queryUsage(PluginCall call) {
        int days = Math.max(1, Math.min(30, call.getInt("days", 7)));
        long end = System.currentTimeMillis();
        long start = end - days * 86_400_000L;

        Map<String, Long> totals = new HashMap<>();
        UsageStatsManager manager =
                (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        if (manager != null) {
            List<UsageStats> stats =
                    manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end);
            if (stats != null) {
                for (UsageStats stat : stats) {
                    long ms = stat.getTotalTimeInForeground();
                    if (ms > 0) {
                        totals.merge(stat.getPackageName(), ms, Long::sum);
                    }
                }
            }
        }

        List<Map.Entry<String, Long>> ranked = new ArrayList<>(totals.entrySet());
        ranked.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));

        PackageManager pm = getContext().getPackageManager();
        JSArray usage = new JSArray();
        for (int i = 0; i < ranked.size() && i < 50; i++) {
            String pkg = ranked.get(i).getKey();
            JSObject row = new JSObject();
            row.put("package", pkg);
            row.put("label", appLabel(pm, pkg));
            row.put("ms", ranked.get(i).getValue());
            usage.put(row);
        }

        JSObject result = new JSObject();
        result.put("usage", usage);
        result.put("days", days);
        call.resolve(result);
    }

    /* ---------- helpers ---------- */

    private boolean usageAccessGranted() {
        AppOpsManager appOps =
                (AppOpsManager) getContext().getSystemService(Context.APP_OPS_SERVICE);
        if (appOps == null) return false;
        int mode;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            mode = appOps.unsafeCheckOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    getContext().getPackageName());
        } else {
            mode = appOps.checkOpNoThrow(
                    AppOpsManager.OPSTR_GET_USAGE_STATS,
                    Process.myUid(),
                    getContext().getPackageName());
        }
        return mode == AppOpsManager.MODE_ALLOWED;
    }

    /** Best-effort human name; package visibility can hide it, so fall back. */
    private String appLabel(PackageManager pm, String pkg) {
        try {
            return pm.getApplicationLabel(pm.getApplicationInfo(pkg, 0)).toString();
        } catch (Exception err) {
            return pkg;
        }
    }

    private Intent appDetailsIntent() {
        return new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                Uri.parse("package:" + getContext().getPackageName()));
    }

    private void open(Intent intent) {
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(intent);
    }
}
