package com.lockin.app;

import android.Manifest;
import android.accessibilityservice.AccessibilityServiceInfo;
import android.app.Activity;
import android.app.ActivityManager;
import android.app.AppOpsManager;
import android.app.admin.DevicePolicyManager;
import android.app.usage.UsageStats;
import android.app.usage.UsageStatsManager;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ActivityInfo;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
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
import java.util.Calendar;
import java.util.HashMap;
import java.util.Iterator;
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

    /** Releases lock task when a strict session's fail-open deadline passes. */
    private final Handler strictTimer = new Handler(Looper.getMainLooper());
    private Runnable strictRelease;

    /* ---------- shell ---------- */

    /** A notification tap may have asked for Schedule before the web booted. */
    @PluginMethod
    public void consumeRoute(PluginCall call) {
        JSObject result = new JSObject();
        result.put("route", MainActivity.consumeRoute());
        call.resolve(result);
    }

    /** Start/Skip taps taken while the app was closed, drained once. */
    @PluginMethod
    public void consumeAlarmActions(PluginCall call) {
        JSObject result = new JSObject();
        result.put("actions", AlarmActions.consume(getContext()));
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

        JSObject result = new JSObject();
        result.put("usage", usageRows(start, end, 50));
        result.put("days", days);
        call.resolve(result);
    }

    /** Today only, from local midnight — the number Control and Stats show. */
    @PluginMethod
    public void queryUsageToday(PluginCall call) {
        long now = System.currentTimeMillis();
        JSObject result = new JSObject();
        result.put("usage", usageRows(BlockingStore.startOfDay(now), now, 30));
        call.resolve(result);
    }

    /** Seven (or N) local days, oldest first, for the rail. */
    @PluginMethod
    public void queryUsageDaily(PluginCall call) {
        int days = Math.max(1, Math.min(30, call.getInt("days", 7)));
        long now = System.currentTimeMillis();
        Calendar calendar = Calendar.getInstance();
        calendar.setTimeInMillis(now);

        JSArray out = new JSArray();
        for (int i = days - 1; i >= 0; i--) {
            Calendar day = (Calendar) calendar.clone();
            day.add(Calendar.DAY_OF_YEAR, -i);
            long start = BlockingStore.startOfDay(day.getTimeInMillis());
            long end = Math.min(now, BlockingStore.nextMidnight(start));

            long total = 0;
            UsageStatsManager manager =
                    (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
            if (manager != null) {
                List<UsageStats> stats =
                        manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end);
                if (stats != null) {
                    for (UsageStats stat : stats) {
                        if (isSelf(stat.getPackageName())) continue;
                        total += Math.max(0, stat.getTotalTimeInForeground());
                    }
                }
            }

            JSObject row = new JSObject();
            row.put("day", BlockingStore.dayKey(start));
            row.put("ms", total);
            out.put(row);
        }

        JSObject result = new JSObject();
        result.put("days", out);
        call.resolve(result);
    }

    /** Lockin's own package — never part of the phone's measured screen time. */
    private boolean isSelf(String pkg) {
        if (pkg == null) return false;
        String self = getContext().getPackageName();
        return pkg.equals(self) || pkg.equals("com.lockin.app");
    }

    private JSArray usageRows(long start, long end, int limit) {
        Map<String, Long> totals = new HashMap<>();
        UsageStatsManager manager =
                (UsageStatsManager) getContext().getSystemService(Context.USAGE_STATS_SERVICE);
        if (manager != null) {
            List<UsageStats> stats =
                    manager.queryUsageStats(UsageStatsManager.INTERVAL_DAILY, start, end);
            if (stats != null) {
                for (UsageStats stat : stats) {
                    /* Lockin is where the studying happens; its own screen time
                       is not something the student should see counted. */
                    if (isSelf(stat.getPackageName())) continue;
                    long ms = stat.getTotalTimeInForeground();
                    if (ms > 0) totals.merge(stat.getPackageName(), ms, Long::sum);
                }
            }
        }

        List<Map.Entry<String, Long>> ranked = new ArrayList<>(totals.entrySet());
        ranked.sort((a, b) -> Long.compare(b.getValue(), a.getValue()));

        PackageManager pm = getContext().getPackageManager();
        JSArray usage = new JSArray();
        for (int i = 0; i < ranked.size() && i < limit; i++) {
            String pkg = ranked.get(i).getKey();
            JSObject row = new JSObject();
            row.put("package", pkg);
            row.put("label", appLabel(pm, pkg));
            row.put("ms", ranked.get(i).getValue());
            usage.put(row);
        }
        return usage;
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

    /* ---------- app limits ---------- */

    @PluginMethod
    public void setAppLimits(PluginCall call) {
        JSObject input = call.getObject("limits");
        JSONObject limits = new JSONObject();
        if (input != null) {
            Iterator<String> keys = input.keys();
            while (keys.hasNext()) {
                String pkg = keys.next();
                if (pkg == null) continue;
                pkg = pkg.trim();
                if (pkg.isEmpty() || pkg.length() > 200) continue;
                int minutes = input.optInt(pkg, 0);
                if (minutes <= 0) continue;
                try {
                    limits.put(pkg, Math.min(1440, minutes));
                } catch (JSONException ignored) {
                    /* skip one malformed entry, keep the rest */
                }
            }
        }
        BlockingStore.writeLimits(getContext(), limits);
        LockinAccessibilityService.refreshIfRunning();
        call.resolve(blockingStatusObject());
    }

    /* ---------- strict study mode (kiosk) ---------- */

    @PluginMethod
    public void strictStatus(PluginCall call) {
        call.resolve(strictStatusObject());
    }

    /** Change the allowlist without arming or disarming a session. */
    @PluginMethod
    public void setStrictPackages(PluginCall call) {
        JSONArray packages = packagesArray(call.getArray("packages"));
        BlockingStore.Config config = BlockingStore.read(getContext());
        BlockingStore.writeStrict(getContext(), config.strict, packages, config.strictUntil);
        LockinAccessibilityService.refreshIfRunning();
        call.resolve(strictStatusObject());
    }

    @PluginMethod
    public void startStrictMode(PluginCall call) {
        JSArray input = call.getArray("packages");
        JSONArray packages = packagesArray(input);

        long now = System.currentTimeMillis();
        Long requested = call.getLong("until");
        long until = requested == null ? now + 4 * 60 * 60 * 1000L : requested;
        if (until <= now) until = now + 60_000L;

        BlockingStore.writeStrict(getContext(), true, packages, until);

        final long deadline = until;
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(strictStatusObject());
            return;
        }
        activity.runOnUiThread(() -> {
            enterLockTask(activity, packages, deadline);
            call.resolve(strictStatusObject());
        });
    }

    /** Keep the fail-open deadline ahead of a live session. */
    @PluginMethod
    public void refreshStrictMode(PluginCall call) {
        long now = System.currentTimeMillis();
        Long requested = call.getLong("until");
        long until = requested == null ? 0L : requested;

        BlockingStore.Config config = BlockingStore.read(getContext());
        if (config.strict && until > now) {
            BlockingStore.refreshStrict(getContext(), until);
            Activity activity = getActivity();
            if (activity != null) {
                activity.runOnUiThread(() -> scheduleStrictRelease(activity, until));
            }
        }
        call.resolve(strictStatusObject());
    }

    @PluginMethod
    public void stopStrictMode(PluginCall call) {
        BlockingStore.clearStrict(getContext());
        Activity activity = getActivity();
        if (activity == null) {
            call.resolve(strictStatusObject());
            return;
        }
        activity.runOnUiThread(() -> {
            cancelStrictRelease();
            releaseLockTask(activity);

            DevicePolicyManager dpm = devicePolicy();
            if (dpm != null && isDeviceOwner()) {
                try {
                    dpm.setLockTaskPackages(adminComponent(),
                            new String[]{getContext().getPackageName()});
                    if (Build.VERSION.SDK_INT >= 28) {
                        dpm.setLockTaskFeatures(adminComponent(),
                                DevicePolicyManager.LOCK_TASK_FEATURE_SYSTEM_INFO);
                    }
                } catch (SecurityException ignored) {
                    /* the device owner was removed; nothing to restore */
                }
            }
            call.resolve(strictStatusObject());
        });
    }

    /** Open an allowlisted app from inside the session room. */
    @PluginMethod
    public void launchApp(PluginCall call) {
        String pkg = call.getString("package", "");
        if (pkg == null || pkg.trim().isEmpty()) {
            call.reject("No package");
            return;
        }
        try {
            Intent intent = getContext().getPackageManager().getLaunchIntentForPackage(pkg.trim());
            if (intent == null) {
                call.reject("App not installed");
                return;
            }
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK
                    | Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED);
            getContext().startActivity(intent);
            call.resolve();
        } catch (RuntimeException err) {
            call.reject("Could not open that app");
        }
    }

    /* ---------- helpers ---------- */

    private JSObject blockingStatusObject() {
        BlockingStore.Config config = BlockingStore.read(getContext());
        long now = System.currentTimeMillis();

        JSObject result = new JSObject();
        result.put("service", accessibilityEnabled());
        result.put("enabled", config.enabled);

        JSArray packages = new JSArray();
        for (String pkg : config.packages) packages.put(pkg);
        result.put("packages", packages);
        result.put("windowCount", config.windows.size());

        try {
            JSONObject limits = new JSONObject();
            for (Map.Entry<String, Integer> entry : config.limits.entrySet()) {
                limits.put(entry.getKey(), entry.getValue());
            }
            result.put("limits", limits);

            JSONObject usage = new JSONObject();
            for (Map.Entry<String, Long> entry
                    : BlockingStore.usageToday(getContext(), now).entrySet()) {
                usage.put(entry.getKey(), entry.getValue());
            }
            result.put("usage", usage);
        } catch (JSONException ignored) {
            /* the status still carries the rest */
        }

        result.put("strictActive", config.strictActive(now));
        result.put("strictArmed", config.strict);
        result.put("strictUntil", config.strictUntil);
        result.put("deviceOwner", isDeviceOwner());
        result.put("lockTask", lockTaskState());

        JSArray strictPackages = new JSArray();
        for (String pkg : config.strictPackages) strictPackages.put(pkg);
        result.put("strictPackages", strictPackages);

        BlockingStore.Window active = config.activeWindow(now);
        if (active != null) result.put("active", windowObject(active));
        BlockingStore.Window next = config.nextWindow(now);
        if (next != null) result.put("next", windowObject(next));
        return result;
    }

    private JSObject strictStatusObject() {
        BlockingStore.Config config = BlockingStore.read(getContext());
        long now = System.currentTimeMillis();
        PackageManager pm = getContext().getPackageManager();

        JSObject result = new JSObject();
        result.put("deviceOwner", isDeviceOwner());
        result.put("active", config.strictActive(now));
        result.put("armed", config.strict);
        result.put("until", config.strictUntil);
        result.put("lockTask", lockTaskState());

        JSArray packages = new JSArray();
        JSArray apps = new JSArray();
        for (String pkg : config.strictPackages) {
            packages.put(pkg);
            JSObject app = new JSObject();
            app.put("package", pkg);
            app.put("label", appLabel(pm, pkg));
            apps.put(app);
        }
        result.put("packages", packages);
        result.put("apps", apps);
        return result;
    }

    private JSObject windowObject(BlockingStore.Window window) {
        JSObject out = new JSObject();
        out.put("label", window.label);
        out.put("start", window.start);
        out.put("end", window.end);
        return out;
    }

    /** Normalize a JS package list; protected packages are never strict targets. */
    private JSONArray packagesArray(JSArray input) {
        JSONArray out = new JSONArray();
        if (input == null) return out;

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
        for (String pkg : unique) out.put(pkg);
        return out;
    }

    private void enterLockTask(Activity activity, JSONArray packages, long until) {
        DevicePolicyManager dpm = devicePolicy();
        if (dpm != null && isDeviceOwner()) {
            Set<String> allow = new LinkedHashSet<>();
            for (int i = 0; i < packages.length(); i++) {
                String pkg = packages.optString(i, "").trim();
                if (!pkg.isEmpty()) allow.add(pkg);
            }
            allow.add(getContext().getPackageName());
            try {
                dpm.setLockTaskPackages(adminComponent(), allow.toArray(new String[0]));
                if (Build.VERSION.SDK_INT >= 28) {
                    dpm.setLockTaskFeatures(adminComponent(),
                            DevicePolicyManager.LOCK_TASK_FEATURE_NONE);
                }
            } catch (SecurityException ignored) {
                /* device owner was removed between the check and the call */
            }
        }

        try {
            activity.startLockTask();
        } catch (RuntimeException ignored) {
            /* screen pinning may be disabled; the service still holds the line */
        }
        scheduleStrictRelease(activity, until);
    }

    /** The kiosk must not outlive its session, even if the web layer died. */
    private void scheduleStrictRelease(Activity activity, long until) {
        cancelStrictRelease();
        long delay = Math.max(1000L, until - System.currentTimeMillis());
        strictRelease = () -> releaseLockTask(activity);
        strictTimer.postDelayed(strictRelease, delay);
    }

    private void cancelStrictRelease() {
        if (strictRelease != null) {
            strictTimer.removeCallbacks(strictRelease);
            strictRelease = null;
        }
    }

    private void releaseLockTask(Activity activity) {
        try {
            ActivityManager am = (ActivityManager)
                    getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am != null && am.getLockTaskModeState() != ActivityManager.LOCK_TASK_MODE_NONE) {
                activity.stopLockTask();
            }
        } catch (RuntimeException ignored) {
            /* already out of lock task */
        }
    }

    private boolean isDeviceOwner() {
        DevicePolicyManager dpm = devicePolicy();
        return dpm != null && dpm.isDeviceOwnerApp(getContext().getPackageName());
    }

    private DevicePolicyManager devicePolicy() {
        return (DevicePolicyManager)
                getContext().getSystemService(Context.DEVICE_POLICY_SERVICE);
    }

    private ComponentName adminComponent() {
        return new ComponentName(getContext(), LockinDeviceAdminReceiver.class);
    }

    private String lockTaskState() {
        try {
            ActivityManager am = (ActivityManager)
                    getContext().getSystemService(Context.ACTIVITY_SERVICE);
            if (am == null) return "none";
            switch (am.getLockTaskModeState()) {
                case ActivityManager.LOCK_TASK_MODE_LOCKED:
                    return "locked";
                case ActivityManager.LOCK_TASK_MODE_PINNED:
                    return "pinned";
                default:
                    return "none";
            }
        } catch (RuntimeException err) {
            return "none";
        }
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
