package com.lockin.app;

import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.provider.Settings;
import android.telecom.TelecomManager;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

/**
 * Packages Lockin must never cover, whatever the stored list says.
 *
 * Blocking a launcher, Settings or the dialer is a lockout waiting to happen:
 * the user could not leave the overlay, open the service settings, or call for
 * help. Lockin also never covers itself. The app picker hides these packages,
 * and the service re-checks the set on every foreground change so an older
 * saved list cannot trap anyone.
 */
final class ProtectedApps {

    private ProtectedApps() {}

    static Set<String> of(Context context) {
        Set<String> out = new HashSet<>();
        out.add(context.getPackageName());
        out.add("android");
        out.add("com.android.systemui");

        PackageManager pm = context.getPackageManager();
        addAll(out, pm, new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME));
        ResolveInfo home = pm.resolveActivity(
                new Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME),
                PackageManager.MATCH_DEFAULT_ONLY);
        if (home != null && home.activityInfo != null) {
            out.add(home.activityInfo.packageName);
        }
        addAll(out, pm, new Intent(Settings.ACTION_SETTINGS));

        String dialer = null;
        try {
            TelecomManager telecom =
                    (TelecomManager) context.getSystemService(Context.TELECOM_SERVICE);
            if (telecom != null) dialer = telecom.getDefaultDialerPackage();
        } catch (Exception ignored) {
            /* no telecom service — fall back to the intent lookup below */
        }
        if (dialer == null || dialer.isEmpty()) {
            ResolveInfo info = pm.resolveActivity(
                    new Intent(Intent.ACTION_DIAL), PackageManager.MATCH_DEFAULT_ONLY);
            if (info != null && info.activityInfo != null) {
                dialer = info.activityInfo.packageName;
            }
        }
        if (dialer != null && !dialer.isEmpty()) out.add(dialer);

        return out;
    }

    private static void addAll(Set<String> out, PackageManager pm, Intent intent) {
        List<ResolveInfo> rows = pm.queryIntentActivities(intent, 0);
        if (rows == null) return;
        for (ResolveInfo info : rows) {
            if (info.activityInfo != null && info.activityInfo.packageName != null) {
                out.add(info.activityInfo.packageName);
            }
        }
    }
}
