package com.lockin.app;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * Shared chrome for the home-screen widgets. Each widget is a small window into
 * numbers the web app already owns; none of them scan usage or start anything.
 */
final class WidgetSurface {

    private WidgetSurface() {}

    static RemoteViews frame(Context ctx, int layout) {
        return new RemoteViews(ctx.getPackageName(), layout);
    }

    static void fill(Context ctx, RemoteViews views, String title,
                     String big, String kicker, String badge) {
        views.setTextViewText(R.id.widget_title, title);
        views.setTextViewText(R.id.widget_big, big);
        views.setTextViewText(R.id.widget_kicker, kicker);
        views.setTextViewText(R.id.widget_badge, badge);
    }

    static void open(Context ctx, RemoteViews views) {
        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);
    }
}
