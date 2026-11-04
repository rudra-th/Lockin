package com.lockin.app;

import android.accessibilityservice.AccessibilityService;
import android.animation.ObjectAnimator;
import android.content.ComponentName;
import android.content.pm.PackageManager;
import android.graphics.PixelFormat;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.WindowManager;
import android.view.accessibility.AccessibilityEvent;
import android.widget.ImageView;
import android.widget.ProgressBar;
import android.widget.TextView;

import java.lang.ref.WeakReference;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * The blocking half of Lockin on Android. It listens for one event only —
 * "a window came to the front" — and never reads window content, text or
 * keystrokes (the service config says so, and the platform enforces it).
 *
 * When the foreground package is on the user's list and a focus window is
 * active, a full-screen accessibility overlay covers the app with the block
 * name and a live countdown. The only action is Leave, which goes home. Lockin
 * itself, a protected app (launcher, Settings, dialer), an empty list and a gap
 * between windows all fail open: the overlay is hidden and nothing pretends to
 * block.
 */
public class LockinAccessibilityService extends AccessibilityService {

    private static WeakReference<LockinAccessibilityService> running =
            new WeakReference<>(null);

    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final SimpleDateFormat untilFormat =
            new SimpleDateFormat("HH:mm", Locale.getDefault());

    private WindowManager windowManager;
    private View overlay;
    private ObjectAnimator pulse;
    private String overlayPackage;
    private String lastForegroundPackage;
    private long windowStart;
    private long windowEnd;
    private Set<String> protectedPackages = new HashSet<>();
    private final Map<String, Boolean> activityCache = new HashMap<>();

    /** Called after the config changes so a visible overlay follows it at once. */
    public static void refreshIfRunning() {
        LockinAccessibilityService service = running.get();
        if (service != null) service.ticker.post(service::onConfigChanged);
    }

    @Override
    protected void onServiceConnected() {
        super.onServiceConnected();
        running = new WeakReference<>(this);
        windowManager = (WindowManager) getSystemService(WINDOW_SERVICE);
        protectedPackages = ProtectedApps.of(this);
        ticker.removeCallbacks(watch);
        ticker.postDelayed(watch, 15000);
    }

    @Override
    public void onAccessibilityEvent(AccessibilityEvent event) {
        if (event == null || event.getEventType() != AccessibilityEvent.TYPE_WINDOW_STATE_CHANGED) {
            return;
        }
        CharSequence name = event.getPackageName();
        if (name == null) return;
        String pkg = name.toString();

        /* Only an activity window means "an app came to the front". The IME,
           the notification shade, dialogs, toasts and our own overlay all fire
           this event too; treating those as app changes would make the overlay
           blink away (or appear over the wrong app). */
        if (!isActivity(pkg, event.getClassName())) return;

        lastForegroundPackage = pkg;

        if (pkg.equals(getPackageName())) {
            hideOverlay();
            return;
        }

        /* Launchers, Settings and the dialer must stay reachable even if an
           older saved list still contains them. */
        if (protectedPackages.contains(pkg)) {
            hideOverlay();
            return;
        }

        BlockingStore.Config config = BlockingStore.read(this);
        if (!config.enabled || !config.packages.contains(pkg)) {
            hideOverlay();
            return;
        }

        long now = System.currentTimeMillis();
        BlockingStore.Window window = config.activeWindow(now);
        if (window == null) {
            hideOverlay();
            return;
        }
        showOverlay(pkg, window);
    }

    @Override
    public void onInterrupt() {
        hideOverlay();
    }

    @Override
    public void onDestroy() {
        hideOverlay();
        ticker.removeCallbacks(watch);
        running = new WeakReference<>(null);
        super.onDestroy();
    }

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

    /* ---------- overlay ---------- */

    private void showOverlay(String pkg, BlockingStore.Window window) {
        if (overlay != null && pkg.equals(overlayPackage)) {
            windowStart = window.start;
            windowEnd = window.end;
            ((TextView) overlay.findViewById(R.id.block_label)).setText(window.label);
            paint();
            return;
        }
        hideOverlay();

        overlayPackage = pkg;
        windowStart = window.start;
        windowEnd = window.end;

        View view = LayoutInflater.from(this).inflate(R.layout.overlay_block, null);
        ((TextView) view.findViewById(R.id.block_label)).setText(window.label);
        view.findViewById(R.id.block_leave).setOnClickListener(v -> {
            hideOverlay();
            performGlobalAction(GLOBAL_ACTION_HOME);
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
            return;
        }

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
    }

    private void cancelPulse() {
        if (pulse == null) return;
        pulse.cancel();
        pulse = null;
    }

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            if (overlay == null) return;
            long now = System.currentTimeMillis();
            if (now >= windowEnd && !advanceWindow(now)) {
                hideOverlay();
                return;
            }
            paint();
            ticker.postDelayed(this, 1000);
        }
    };

    /**
     * A slow safety net for the one case the event stream misses: the user is
     * already inside a blocked app when a window starts. Every 15 seconds we
     * look at the last real activity again; if it is now inside a window, the
     * overlay appears without waiting for an app switch.
     */
    private final Runnable watch = new Runnable() {
        @Override
        public void run() {
            checkForeground();
            ticker.postDelayed(this, 15000);
        }
    };

    private void checkForeground() {
        if (overlay != null || lastForegroundPackage == null) return;
        if (lastForegroundPackage.equals(getPackageName())) return;
        if (protectedPackages.contains(lastForegroundPackage)) return;

        BlockingStore.Config config = BlockingStore.read(this);
        if (!config.enabled || !config.packages.contains(lastForegroundPackage)) return;

        BlockingStore.Window window = config.activeWindow(System.currentTimeMillis());
        if (window != null) showOverlay(lastForegroundPackage, window);
    }

    /**
     * When two blocks sit back to back, the overlay moves to the next window
     * instead of blinking off for a second and waiting for a window event.
     */
    private boolean advanceWindow(long now) {
        if (overlayPackage == null) return false;
        BlockingStore.Config config = BlockingStore.read(this);
        if (!config.enabled || !config.packages.contains(overlayPackage)) return false;
        BlockingStore.Window next = config.activeWindow(now);
        if (next == null) return false;
        windowStart = next.start;
        windowEnd = next.end;
        ((TextView) overlay.findViewById(R.id.block_label)).setText(next.label);
        return true;
    }

    private void paint() {
        if (overlay == null) return;
        long now = System.currentTimeMillis();
        long left = Math.max(0, windowEnd - now);

        ((TextView) overlay.findViewById(R.id.block_countdown)).setText(fmt(left));
        ((TextView) overlay.findViewById(R.id.block_until))
                .setText(getString(R.string.block_until, untilFormat.format(new Date(windowEnd))));

        ProgressBar bar = overlay.findViewById(R.id.block_bar);
        long span = Math.max(1, windowEnd - windowStart);
        bar.setProgress((int) Math.max(0, Math.min(1000, (left * 1000) / span)));
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

    /** The user changed the list or the master switch while the overlay was up. */
    private void onConfigChanged() {
        protectedPackages = ProtectedApps.of(this);
        if (overlay == null) {
            checkForeground();
            return;
        }
        BlockingStore.Config config = BlockingStore.read(this);
        long now = System.currentTimeMillis();
        BlockingStore.Window window = config.activeWindow(now);

        if (!config.enabled || overlayPackage == null
                || !config.packages.contains(overlayPackage) || window == null
                || protectedPackages.contains(overlayPackage)) {
            hideOverlay();
            return;
        }

        windowStart = window.start;
        windowEnd = window.end;
        ((TextView) overlay.findViewById(R.id.block_label)).setText(window.label);
        paint();
    }
}
