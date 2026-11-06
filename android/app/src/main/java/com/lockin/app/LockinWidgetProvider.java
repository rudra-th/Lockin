package com.lockin.app;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.widget.RemoteViews;

/**
 * The home-screen widget: today's focus time against the daily target, the
 * streak, and what comes next. It only reads the snapshot the web app pushed —
 * it never scans usage or starts anything. Tapping opens Lockin.
 */
public class LockinWidgetProvider extends AppWidgetProvider {

    /** Redraw every placed widget. Called when the app pushes new numbers. */
    static void refreshAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        ComponentName provider = new ComponentName(ctx, LockinWidgetProvider.class);
        int[] ids = manager.getAppWidgetIds(provider);
        for (int id : ids) update(ctx, manager, id);
        FocusTileService.requestUpdate(ctx);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) update(ctx, manager, id);
    }

    private static void update(Context ctx, AppWidgetManager manager, int id) {
        WidgetStore.Snapshot snapshot = WidgetStore.read(ctx);
        RemoteViews views = new RemoteViews(ctx.getPackageName(), R.layout.widget_lockin);

        views.setTextViewText(R.id.widget_big,
                WidgetStore.duration(snapshot.minutes) + " / " + WidgetStore.duration(snapshot.goal));
        views.setProgressBar(R.id.widget_bar, 100, snapshot.percent(), false);

        String kicker;
        if (snapshot.updatedAt == 0) {
            kicker = ctx.getString(R.string.widget_unset);
        } else if (snapshot.live(System.currentTimeMillis())) {
            kicker = ctx.getString(R.string.widget_session);
        } else if (snapshot.next != null && !snapshot.next.isEmpty()) {
            kicker = ctx.getString(R.string.widget_next, snapshot.next);
        } else {
            kicker = ctx.getString(R.string.widget_open);
        }
        views.setTextViewText(R.id.widget_kicker, kicker);

        String badge;
        if (snapshot.streak > 0) {
            badge = ctx.getString(R.string.widget_streak, snapshot.streak);
        } else if (snapshot.met()) {
            badge = ctx.getString(R.string.widget_met);
        } else {
            badge = "";
        }
        views.setTextViewText(R.id.widget_badge, badge);

        Intent open = new Intent(ctx, MainActivity.class);
        open.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent pending = PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        views.setOnClickPendingIntent(R.id.widget_root, pending);

        manager.updateAppWidget(id, views);
    }
}
