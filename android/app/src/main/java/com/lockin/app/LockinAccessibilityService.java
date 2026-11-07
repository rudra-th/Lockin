package com.lockin.app;

import android.accessibilityservice.AccessibilityService;
import android.animation.ObjectAnimator;
import android.content.BroadcastReceiver;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.view.accessibility.AccessibilityWindowInfo;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The blocking half of Lockin on Android. It listens for one event only —
 * "a window came to the front" — and never reads window content, text or
 * keystrokes (the service config says so, and the platform enforces it).
 *
 * Three reasons can cover an app:
 *   - a focus window (the apps the user chose, during a block or session),
 *   - a spent daily allowance (per-app limit, resets at midnight),
 *   - strict study mode (every app except the allowlist, until the session ends).
 *
 * Lockin itself and every protected app (launchers, Settings, the dialer)
 * always fail open. An empty list, the service off, a gap between windows or
 * a stale strict deadline also fail open: the overlay is hidden and nothing
 * pretends to block.
 */
public class LockinAccessibilityService extends AccessibilityService {

    private static final int REASON_FOCUS = 0;
    private static final int REASON_LIMIT = 1;
    private static final int REASON_STRICT = 2;

    /* A synthetic package for the full-surface strict overlay. It is not an
       app: it marks "more than one app is visible in strict mode". */
    private static final String STRICT_SURFACE = "\u0000strict";

    private static WeakReference<LockinAccessibilityService> running =
            new WeakReference<>(null);

    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final SimpleDateFormat untilFormat =
            new SimpleDateFormat("HH:mm", Locale.getDefault());

    private WindowManager windowManager;
    private View overlay;
    private ObjectAnimator pulse;
    private Info overlayInfo;
    private String overlayPackage;

    private String foregroundPackage;
    private long foregroundSince;
    private boolean screenOn = true;

    private String lastForegroundPackage;
    private Set<String> protectedPackages = new HashSet<>();
    private final Map<String, Boolean> activityCache = new HashMap<>();

    /** One overlay state, derived fresh from the config on every check. */
    private static final class Info {
        final int reason;
        final String kicker;
        final String label;
        final String left;
        final String until;
        final String foot;
        final String action;
        final long start;
        final long end;
        final boolean showClock;
        final boolean showBar;

        Info(int reason, String kicker, String label, String left, String until,
             String foot, String action, long start, long end,
             boolean showClock, boolean showBar) {
            this.reason = reason;
            this.kicker = kicker;
            this.label = label;
            this.left = left;
            this.until = until;
            this.foot = foot;
            this.action = action;
            this.start = start;
            this.end = end;
            this.showClock = showClock;
            this.showBar = showBar;
        }
    }

    /** Called after the config changes so a visible overlay follows it at once. */
    public static void refreshIfRunning() {
        LockinAccessibilityService service = running.get();
        if (service != null) service.ticker.post(service::onConfigChanged);
    }

    /* ---------- lifecycle ---------- */

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = new WeakReference<>(this);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        protectedPackages = ProtectedApps.of(this);

        IntentFilter screen = new IntentFilter();
        screen.addAction(Intent.ACTION_SCREEN_OFF);
        screen.addAction(Intent.ACTION_SCREEN_ON);
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                registerReceiver(screenReceiver, screen, Context.RECEIVER_NOT_EXPORTED);
            } else {
                registerReceiver(screenReceiver, screen);
            }
        } catch (RuntimeException ignored) {
            /* the service still works without the screen clock */
        }

        ticker.removeCallbacks(watch);
        ticker.postDelayed(watch, 15000);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null) return;
        int type = event.getEventType();

        /* Split-screen and floating windows fire this instead of a normal
           foreground change: count the visible app windows and cover both
           panes when strict mode is live. */
        if (type == AccessibilityEvent.TYPE_WINDOWS_CHANGED) {
            long changedAt = System.currentTimeMillis();
            if (BlockingStore.read(this).strictActive(changedAt)) evaluateStrictSurface(changedAt);
            return;
        }
        if (type != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) return;

        CharSequence name = event.getPackageName();
        if (name == null) return;
        String pkg = name.toString();

        /* Only an activity window means "an app came to the front". The IME,
           the notification shade, dialogs, toasts and our own overlay all fire
           this event too; treating those as app changes would make the overlay
           blink away (or appear over the wrong app). */
        if (!isActivity(pkg, event.getClassName())) return;

        lastForegroundPackage = pkg;
        long now = System.currentTimeMillis();

        if (pkg.equals(getPackageName())) {
            pauseUsage(now);
            /* Returning to Lockin does not clear a split-screen neighbour. */
            if (BlockingStore.read(this).strictActive(now)) evaluateStrictSurface(now);
            else hideOverlay();
            return;
        }

        noteForeground(pkg, now);

        /* Launchers, Settings and the dialer must stay reachable even if an
           older saved list still contains them. */
        if (protectedPackages.contains(pkg)) {
            hideOverlay();
            return;
        }

        evaluate(pkg, now);
    }

    @Override
    public void onInterrupt() {
        hideOverlay();
    }

    @Override
    public void onDestroy() {
        flushUsage(System.currentTimeMillis());
        ticker.removeCallbacks(watch);
        try {
            unregisterReceiver(screenReceiver);
        } catch (RuntimeException ignored) {
            /* never registered */
        }
        hideOverlay();
        running = new WeakReference<>(null);
        super.onDestroy();
    }

    /* ---------- foreground usage clock ---------- */

    private void noteForeground(String pkg, long now) {
        if (pkg.equals(foregroundPackage)) return;
        flushUsage(now);
        foregroundPackage = pkg;
        foregroundSince = now;
    }

    private void flushUsage(long now) {
        if (foregroundPackage == null || foregroundSince <= 0) return;
        long ms = now - foregroundSince;
        if (ms > 0) BlockingStore.addUsage(this, foregroundPackage, ms, now);
        foregroundSince = now;
    }

    private void pauseUsage(long now) {
        flushUsage(now);
        foregroundSince = 0;
    }

    private void resumeUsage(long now) {
        if (foregroundPackage != null && foregroundSince <= 0 && overlay == null) {
            foregroundSince = now;
        }
    }

    private final BroadcastReceiver screenReceiver = new BroadcastReceiver() {
        @Override
        public void onReceive(Context context, Intent intent) {
            long now = System.currentTimeMillis();
            if (Intent.ACTION_SCREEN_OFF.equals(intent.getAction())) {
                screenOn = false;
                flushUsage(now);
                foregroundSince = 0;
                hideOverlay();
            } else if (Intent.ACTION_SCREEN_ON.equals(intent.getAction())) {
                screenOn = true;
                resumeUsage(now);
                evaluate(lastForegroundPackage, now);
            }
        }
    };

    /**
     * Is this window a real activity, or an IME / system window / toast?
     *
     * Package visibility can hide a package's components; in that case we
     * cannot tell, so we answer true and let the chosen-app check decide. That
     * keeps a blocked app covered instead of failing open by accident.
     */
    private boolean isActivity(String pkg, CharSequence className) {
        if (className == null) return false;
        String cls = className.toString();
        if (cls.isEmpty()) return false;

        String key = pkg + "/" + cls;
        Boolean cached = activityCache.get(key);
        if (cached != null) return cached;

        boolean activity;
        try {
            getPackageManager().getActivityInfo(new ComponentName(pkg, cls), 0);
            activity = true;
        } catch (PackageManager.NameNotFoundException missing) {
            activity = !isPackageVisible(pkg);
        } catch (RuntimeException err) {
            activity = false;
        }

        if (activityCache.size() > 256) activityCache.clear();
        activityCache.put(key, activity);
        return activity;
    }

    private boolean isPackageVisible(String pkg) {
        try {
            getPackageManager().getPackageInfo(pkg, 0);
            return true;
        } catch (Exception err) {
            return false;
        }
    }

    /* ---------- what should cover this package, if anything ---------- */

    /**
     * Strict mode with more than one visible app window (split-screen, freeform
     * or a floating window) covers the whole surface. Counting windows needs no
     * content access; the config opts into the interactive-window flag only.
     */
    private void evaluateStrictSurface(long now) {
        if (!screenOn) {
            hideOverlay();
            return;
        }
        if (hasSecondAppWindow()) {
            Info info = strictInfo();
            if (overlay != null && STRICT_SURFACE.equals(overlayPackage)) {
                overlayInfo = info;
                applyInfo();
                paint();
                return;
            }
            showOverlay(STRICT_SURFACE, info, now);
            return;
        }
        if (overlayPackage != null && STRICT_SURFACE.equals(overlayPackage)) hideOverlay();
        evaluate(lastForegroundPackage, now);
    }

    private boolean hasSecondAppWindow() {
        List<AccessibilityWindowInfo> windows;
        try {
            windows = getWindows();
        } catch (RuntimeException ignored) {
            return false; // no window access: fail open, never invent a block
        }
        if (windows == null) return false;
        /* getWindows() is the set on screen right now; the service's own
           overlay is an accessibility overlay, not an application window.
           Two application windows means split-screen, freeform or PiP. */
        int apps = 0;
        for (AccessibilityWindowInfo window : windows) {
            if (window == null) continue;
            if (window.getType() != AccessibilityWindowInfo.TYPE_APPLICATION) continue;
            apps += 1;
            if (apps > 1) return true;
        }
        return false;
    }

    private Info strictInfo() {
        return new Info(
                REASON_STRICT,
                getString(R.string.block_strict_kicker),
                getString(R.string.block_strict_title),
                getString(R.string.block_strict_left),
                getString(R.string.block_strict_until),
                getString(R.string.block_strict_foot),
                getString(R.string.block_back),
                0L, 0L, false, false);
    }

    private Info infoFor(String pkg, long now) {
        if (pkg == null) return null;
        if (STRICT_SURFACE.equals(pkg)) {
            return BlockingStore.read(this).strictActive(now) ? strictInfo() : null;
        }
        if (pkg.equals(getPackageName())) return null;
        if (protectedPackages.contains(pkg)) return null;

        BlockingStore.Config config = BlockingStore.read(this);

        /* Strict mode owns the screen while a session is live: every app
           except the user's allowlist is covered. The deadline is refreshed
           by the web app; a stale one fails open. */
        if (config.strictActive(now)) {
            if (config.strictPackages.contains(pkg)) return null;
            return strictInfo();
        }

        if (!config.enabled) return null;

        /* A spent daily allowance holds until midnight, whether or not a focus
           window is running. A manual list entry is a separate reason. */
        int limit = config.limitFor(pkg);
        if (limit > 0) {
            long used = BlockingStore.usageFor(this, pkg, now);
            if (used >= limit * 60_000L) {
                long midnight = BlockingStore.nextMidnight(now);
                return new Info(
                        REASON_LIMIT,
                        getString(R.string.block_limit_kicker),
                        getString(R.string.block_limit_title),
                        getString(R.string.block_limit_left),
                        getString(R.string.block_limit_until),
                        getString(R.string.block_limit_used, fmtUsage(used), limit),
                        getString(R.string.block_leave),
                        BlockingStore.startOfDay(now), midnight, true, true);
            }
        }

        if (!config.packages.contains(pkg)) return null;

        BlockingStore.Window window = config.activeWindow(now);
        if (window == null) return null;

        return new Info(
                REASON_FOCUS,
                getString(R.string.block_kicker),
                window.label,
                getString(R.string.block_left),
                getString(R.string.block_until, untilFormat.format(new Date(window.end))),
                getString(R.string.block_foot),
                getString(R.string.block_leave),
                window.start, window.end, true, true);
    }

    private void evaluate(String pkg, long now) {
        /* Never draw over the lock screen: no app is usable there, and a
           blocking wall on top of the keyguard would look like a bug. */
        if (!screenOn) {
            hideOverlay();
            return;
        }
        Info info = infoFor(pkg, now);
        if (info == null) {
            hideOverlay();
            return;
        }
        if (overlay != null && pkg.equals(overlayPackage)) {
            overlayInfo = info;
            applyInfo();
            paint();
            return;
        }
        showOverlay(pkg, info, now);
    }

    /* ---------- overlay ---------- */

    private void showOverlay(String pkg, Info info, long now) {
        /* The app is on screen, but the user cannot use it; stop spending its
           allowance until they come back for a real visit. */
        pauseUsage(now);
        hideOverlay();

        overlayPackage = pkg;
        overlayInfo = info;

        View view = LayoutInflater.from(this).inflate(R.layout.overlay_block, null);
        view.findViewById(R.id.block_leave).setOnClickListener(v -> {
            int reason = overlayInfo == null ? REASON_FOCUS : overlayInfo.reason;
            hideOverlay();
            if (reason == REASON_STRICT) {
                launchLockin();
            } else {
                performGlobalAction(GLOBAL_ACTION_HOME);
            }
        });

        ImageView icon = view.findViewById(R.id.block_icon);
        pulse = ObjectAnimator.ofFloat(icon, "alpha", 0.45f, 1f);
        pulse.setDuration(1800);
        pulse.setRepeatCount(ObjectAnimator.INFINITE);
        pulse.setRepeatMode(ObjectAnimator.REVERSE);
        pulse.start();

        WindowManager.LayoutParams params = new WindowManager.LayoutParams(
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.MATCH_PARENT,
                WindowManager.LayoutParams.TYPE_ACCESSIBILITY_OVERLAY,
                WindowManager.LayoutParams.FLAG_LAYOUT_IN_SCREEN
                        | WindowManager.LayoutParams.FLAG_LAYOUT_NO_LIMITS,
                PixelFormat.TRANSLUCENT);
        params.gravity = Gravity.TOP | Gravity.START;

        try {
            windowManager.addView(view, params);
            overlay = view;
        } catch (RuntimeException err) {
            /* The window can be rejected while the service is shutting down.
               Fail open rather than crash the service. */
            cancelPulse();
            overlayPackage = null;
            overlayInfo = null;
            return;
        }

        applyInfo();
        paint();
        ticker.post(tick);
    }

    private void hideOverlay() {
        ticker.removeCallbacks(tick);
        cancelPulse();
        if (overlay != null && windowManager != null) {
            try {
                windowManager.removeView(overlay);
            } catch (RuntimeException ignored) {
                /* already detached */
            }
        }
        overlay = null;
        overlayPackage = null;
        overlayInfo = null;
    }

    private void cancelPulse() {
        if (pulse == null) return;
        pulse.cancel();
        pulse = null;
    }

    private void applyInfo() {
        if (overlay == null || overlayInfo == null) return;
        Info info = overlayInfo;

        ((TextView) overlay.findViewById(R.id.block_kicker)).setText(info.kicker);
        ((TextView) overlay.findViewById(R.id.block_label)).setText(info.label);
        ((TextView) overlay.findViewById(R.id.block_leave)).setText(info.action);

        TextView left = overlay.findViewById(R.id.block_left);
        left.setText(info.left);
        left.setVisibility(info.left == null || info.left.isEmpty() ? View.GONE : View.VISIBLE);

        TextView until = overlay.findViewById(R.id.block_until);
        until.setText(info.until);
        until.setVisibility(info.until == null || info.until.isEmpty() ? View.GONE : View.VISIBLE);

        TextView clock = overlay.findViewById(R.id.block_countdown);
        clock.setVisibility(info.showClock ? View.VISIBLE : View.GONE);

        ProgressBar bar = overlay.findViewById(R.id.block_bar);
        bar.setVisibility(info.showBar ? View.VISIBLE : View.GONE);

        TextView foot = overlay.findViewById(R.id.block_foot);
        foot.setText(info.foot);
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (overlay == null) return;
            long now = System.currentTimeMillis();
            Info info = infoFor(overlayPackage, now);
            if (info == null) {
                hideOverlay();
                return;
            }
            overlayInfo = info;
            applyInfo();
            paint();
            ticker.postDelayed(this, 1000);
        }
    };

    /**
     * A slow safety net for the one case the event stream misses: the user is
     * already inside a blocked app when a window starts, or they cross a daily
     * limit without switching apps. Every 15 seconds we re-read the last real
     * activity, flush the usage clock and re-evaluate.
     */
    private final Runnable watch = new Runnable() {
        @Override
        public void run() {
            long now = System.currentTimeMillis();
            flushUsage(now);
            resumeUsage(now);
            if (lastForegroundPackage != null) evaluate(lastForegroundPackage, now);
            ticker.postDelayed(this, 15000);
        }
    };

    private void paint() {
        if (overlay == null || overlayInfo == null) return;
        Info info = overlayInfo;
        long now = System.currentTimeMillis();

        TextView clock = overlay.findViewById(R.id.block_countdown);
        if (info.showClock && info.end > 0) {
            clock.setText(fmt(Math.max(0, info.end - now)));
        }

        ProgressBar bar = overlay.findViewById(R.id.block_bar);
        if (info.showBar) {
            if (info.reason == REASON_LIMIT) {
                bar.setProgress(1000);
            } else {
                long span = Math.max(1, info.end - info.start);
                bar.setProgress((int) Math.max(0, Math.min(1000,
                        ((info.end - now) * 1000) / span)));
            }
        }
    }

    private void launchLockin() {
        try {
            Intent intent = new Intent(this, MainActivity.class);
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            startActivity(intent);
        } catch (RuntimeException ignored) {
            /* fall back to home if the activity cannot be opened */
            performGlobalAction(GLOBAL_ACTION_HOME);
        }
    }

    /** Countdown text: "23:14" under an hour, "1:02:05" above. */
    private String fmt(long ms) {
        long sec = Math.max(0, (ms + 999) / 1000);
        long h = sec / 3600;
        long m = (sec % 3600) / 60;
        long s = sec % 60;
        return h > 0
                ? String.format(Locale.getDefault(), "%d:%02d:%02d", h, m, s)
                : String.format(Locale.getDefault(), "%02d:%02d", m, s);
    }

    private String fmtUsage(long ms) {
        long minutes = ms / 60_000L;
        if (minutes < 1) return "<1m";
        long h = minutes / 60;
        long m = minutes % 60;
        return h > 0
                ? String.format(Locale.getDefault(), "%dh %02dm", h, m)
                : String.format(Locale.getDefault(), "%dm", m);
    }

    /** The user changed the list, a limit or the master switch while an overlay was up. */
    private void onConfigChanged() {
        protectedPackages = ProtectedApps.of(this);
        long now = System.currentTimeMillis();
        if (overlay != null) {
            Info info = infoFor(overlayPackage, now);
            if (info == null) {
                hideOverlay();
            } else {
                overlayInfo = info;
                applyInfo();
                paint();
            }
            return;
        }
        evaluate(lastForegroundPackage, now);
    }
}
