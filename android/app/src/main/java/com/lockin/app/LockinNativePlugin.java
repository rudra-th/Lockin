package com.lockin.app;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.AppOpsManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Process;
import android.provider.Settings;
import android.view.accessibility.AccessibilityManager;

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
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The only native surface the web app talks to. It owns exact alarms,
 * full-screen alarms, usage access, notification permission and the
 * device-local app-blocking config. No UI lives here.
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

    /* ---------- full-screen alarms ---------- */

    @PluginMethod
    public void fullScreenIntentAllowed(PluginCall call) {
        JSObject result = new JSObject();
        result.put("allowed", AlarmReceiver.canUseFullScreen(getContext()));
        call.resolve(result);
    }

    @PluginMethod
    public void openFullScreenIntentSettings(PluginCall call) {
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            intent = new Intent(Settings.ACTION_MANAGE_APP_USE_FULL_SCREEN_INTENT,
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

    /* ---------- app blocking ---------- */

    /** Replace the focus windows the service blocks inside. */
    @PluginMethod
    public void syncBlockingWindows(PluginCall call) {
        JSArray input = call.getArray("windows");
        JSONArray windows = new JSONArray();

        if (input != null) {
            List<Object> items;
            try {
                items = input.toList();
            } catch (JSONException err) {
                items = new ArrayList<>();
            }
            for (Object raw : items) {
                /* Capacitor parses nested objects as org.json.JSONObject, not
                   JSObject; checking for JSObject would silently drop every
                   window. */
                if (!(raw instanceof JSONObject)) continue;
                JSONObject item = (JSONObject) raw;
                long start = item.optLong("start", 0L);
                long end = item.optLong("end", 0L);
                if (start <= 0 || end <= start) continue;
                JSONObject window = new JSONObject();
                try {
                    window.put("start", start);
                    window.put("end", end);
                    window.put("label", item.optString("label", "Focus"));
                    windows.put(window);
                } catch (JSONException ignored) {
                    /* skip a malformed window, keep the rest */
                }
                if (windows.length() >= 500) break;
            }
        }

        BlockingStore.writeWindows(getContext(), windows);
        LockinAccessibilityService.refreshIfRunning();
        call.resolve(blockingStatusObject());
    }

    /** Replace the master switch and the chosen packages. */
    @PluginMethod
    public void setBlockingApps(PluginCall call) {
        boolean enabled = Boolean.TRUE.equals(call.getBoolean("enabled", false));
        JSArray input = call.getArray("packages");
        JSONArray packages = new JSONArray();

        if (input != null) {
            List<Object> items;
            try {
                items = input.toList();
            } catch (JSONException err) {
                items = new ArrayList<>();
            }
            Set<String> protectedPackages = ProtectedApps.of(getContext());
            Set<String> unique = new LinkedHashSet<>();
            for (Object raw : items) {
                if (!(raw instanceof String)) continue;
                String pkg = ((String) raw).trim();
                if (pkg.isEmpty() || pkg.length() > 200) continue;
                if (protectedPackages.contains(pkg)) continue;
                unique.add(pkg);
                if (unique.size() >= 200) break;
            }
            for (String pkg : unique) packages.put(pkg);
        }

        BlockingStore.writeApps(getContext(), enabled, packages);
        LockinAccessibilityService.refreshIfRunning();
        call.resolve(blockingStatusObject());
    }

    @PluginMethod
    public void blockingStatus(PluginCall call) {
        call.resolve(blockingStatusObject());
    }

    @PluginMethod
    public void openAccessibilitySettings(PluginCall call) {
        open(new Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS));
        call.resolve();
    }

    /** Launchable apps only, own package excluded, sorted by label. */
    @PluginMethod
    public void listLaunchableApps(PluginCall call) {
        PackageManager pm = getContext().getPackageManager();
        Intent launcher = new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER);
        List<ResolveInfo> resolved = pm.queryIntentActivities(launcher, 0);
        if (resolved == null) resolved = new ArrayList<>();

        Set<String> protectedPackages = ProtectedApps.of(getContext());
        Map<String, String> labels = new HashMap<>();
        for (ResolveInfo info : resolved) {
            ActivityInfo activity = info.activityInfo;
            if (activity == null || activity.packageName == null) continue;
            String pkg = activity.packageName;
            if (protectedPackages.contains(pkg) || labels.containsKey(pkg)) continue;
            CharSequence label = info.loadLabel(pm);
            labels.put(pkg, label == null || label.length() == 0 ? pkg : label.toString());
        }

        List<Map.Entry<String, String>> rows = new ArrayList<>(labels.entrySet());
        rows.sort((a, b) -> a.getValue().compareToIgnoreCase(b.getValue()));

        JSArray apps = new JSArray();
        for (Map.Entry<String, String> row : rows) {
            JSObject app = new JSObject();
            app.put("package", row.getKey());
            app.put("label", row.getValue());
            apps.put(app);
        }

        JSObject result = new JSObject();
        result.put("apps", apps);
        call.resolve(result);
    }

    /* ---------- helpers ---------- */

    private JSObject blockingStatusObject() {
        BlockingStore.Config config = BlockingStore.read(getContext());
        JSObject result = new JSObject();
        result.put("service", accessibilityEnabled());
        result.put("enabled", config.enabled);

        JSArray packages = new JSArray();
        for (String pkg : config.packages) packages.put(pkg);
        result.put("packages", packages);
        result.put("windowCount", config.windows.size());

        long now = System.currentTimeMillis();
        BlockingStore.Window active = config.activeWindow(now);
        if (active != null) result.put("active", windowObject(active));
        BlockingStore.Window next = config.nextWindow(now);
        if (next != null) result.put("next", windowObject(next));
        return result;
    }

    private JSObject windowObject(BlockingStore.Window window) {
        JSObject out = new JSObject();
        out.put("label", window.label);
        out.put("start", window.start);
        out.put("end", window.end);
        return out;
    }

    private boolean accessibilityEnabled() {
        AccessibilityManager manager =
                (AccessibilityManager) getContext().getSystemService(Context.ACCESSIBILITY_SERVICE);
        String expected = getContext().getPackageName()
                + "/" + LockinAccessibilityService.class.getName();
        String prefix = getContext().getPackageName() + "/";

        if (manager != null) {
            List<AccessibilityServiceInfo> enabled =
                    manager.getEnabledAccessibilityServiceList(AccessibilityServiceInfo.FEEDBACK_ALL_MASK);
            if (enabled != null) {
                for (AccessibilityServiceInfo info : enabled) {
                    String id = info.getId();
                    if (id == null) continue;
                    if (expected.equals(id)) return true;
                    if (id.startsWith(prefix)
                            && id.endsWith(LockinAccessibilityService.class.getSimpleName())) {
                        return true;
                    }
                }
            }
        }

        /* Some OEMs keep the manager list stale for a moment after the user
           flips the switch. The secure setting is the source of truth. */
        try {
            String flat = Settings.Secure.getString(
                    getContext().getContentResolver(),
                    Settings.Secure.ENABLED_ACCESSIBILITY_SERVICES);
            if (flat != null) {
                for (String part : flat.split(":")) {
                    if (part.startsWith(prefix)
                            && part.endsWith(LockinAccessibilityService.class.getSimpleName())) {
                        return true;
                    }
                }
            }
        } catch (Exception ignored) {
            /* fail closed: the UI will ask the user to enable it again */
        }
        return false;
    }

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
