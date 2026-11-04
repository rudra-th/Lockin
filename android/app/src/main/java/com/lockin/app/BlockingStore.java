package com.lockin.app;

import android.content.Context;
import android.content.SharedPreferences;

import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * The device-local home of the app-blocking config. The web app computes the
 * windows and the chosen packages; this class only stores them and answers
 * "is this package blocked right now?".
 *
 * It is deliberately not part of the synced web store: which apps are blocked
 * is a property of this phone, not of the account.
 */
public final class BlockingStore {

    private static final String PREFS = "lockin_blocking";
    private static final String KEY_ENABLED = "enabled";
    private static final String KEY_PACKAGES = "packages";
    private static final String KEY_WINDOWS = "windows";

    /** One focus window, in epoch milliseconds. */
    public static final class Window {
        public final long start;
        public final long end;
        public final String label;

        Window(long start, long end, String label) {
            this.start = start;
            this.end = end;
            this.label = label == null || label.isEmpty() ? "Focus" : label;
        }

        public boolean contains(long now) {
            return start <= now && now < end;
        }
    }

    public static final class Config {
        public final boolean enabled;
        public final Set<String> packages;
        public final List<Window> windows;

        Config(boolean enabled, Set<String> packages, List<Window> windows) {
            this.enabled = enabled;
            this.packages = Collections.unmodifiableSet(packages);
            this.windows = Collections.unmodifiableList(windows);
        }

        public boolean blocks(String pkg, long now) {
            return enabled && packages.contains(pkg) && activeWindow(now) != null;
        }

        /** The latest-starting window that contains `now`; nested blocks win. */
        public Window activeWindow(long now) {
            Window best = null;
            for (Window window : windows) {
                if (!window.contains(now)) continue;
                if (best == null || window.start > best.start) best = window;
            }
            return best;
        }

        public Window nextWindow(long now) {
            for (Window window : windows) {
                if (window.start > now) return window;
            }
            return null;
        }
    }

    private BlockingStore() {}

    private static SharedPreferences prefs(Context context) {
        return context.getApplicationContext()
                .getSharedPreferences(PREFS, Context.MODE_PRIVATE);
    }

    public static Config read(Context context) {
        SharedPreferences p = prefs(context);
        boolean enabled = p.getBoolean(KEY_ENABLED, false);

        Set<String> packages = new LinkedHashSet<>();
        try {
            JSONArray raw = new JSONArray(p.getString(KEY_PACKAGES, "[]"));
            for (int i = 0; i < raw.length(); i++) {
                String pkg = raw.optString(i, "").trim();
                if (!pkg.isEmpty()) packages.add(pkg);
            }
        } catch (JSONException ignored) {
            /* a corrupt list blocks nothing — fail open */
        }

        List<Window> windows = new ArrayList<>();
        try {
            JSONArray raw = new JSONArray(p.getString(KEY_WINDOWS, "[]"));
            for (int i = 0; i < raw.length(); i++) {
                JSONObject item = raw.optJSONObject(i);
                if (item == null) continue;
                long start = item.optLong("start", 0L);
                long end = item.optLong("end", 0L);
                if (start <= 0 || end <= start) continue;
                windows.add(new Window(start, end, item.optString("label", "Focus")));
            }
        } catch (JSONException ignored) {
            /* fail open */
        }
        Collections.sort(windows, (a, b) -> Long.compare(a.start, b.start));

        return new Config(enabled, packages, windows);
    }

    /** Replace the master switch and the chosen packages; windows are kept. */
    public static void writeApps(Context context, boolean enabled, JSONArray packages) {
        prefs(context).edit()
                .putBoolean(KEY_ENABLED, enabled)
                .putString(KEY_PACKAGES, packages.toString())
                .apply();
    }

    /** Replace the window list; the switch and packages are kept. */
    public static void writeWindows(Context context, JSONArray windows) {
        prefs(context).edit()
                .putString(KEY_WINDOWS, windows.toString())
                .apply();
    }
}
