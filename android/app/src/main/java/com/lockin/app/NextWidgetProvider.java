package com.lockin.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

/** The next block on the schedule, without opening the app. */
public class NextWidgetProvider extends AppWidgetProvider {

    static void refreshAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        ComponentName provider = new ComponentName(ctx, NextWidgetProvider.class);
        for (int id : manager.getAppWidgetIds(provider)) update(ctx, manager, id);
    }

    @Override
    public void onUpdate(Context ctx, AppWidgetManager manager, int[] appWidgetIds) {
        for (int id : appWidgetIds) update(ctx, manager, id);
    }

    private static void update(Context ctx, AppWidgetManager manager, int id) {
        WidgetStore.Snapshot snapshot = WidgetStore.read(ctx);
        String big;
        String kicker;
        String badge;
        if (snapshot.nextStart.isEmpty()) {
            big = "\u2014";
            kicker = ctx.getString(R.string.widget_next_none);
            badge = "";
        } else {
            big = snapshot.nextStart;
            kicker = snapshot.nextName;
            badge = snapshot.nextEnd.isEmpty()
                    ? ""
                    : ctx.getString(R.string.widget_next_to, snapshot.nextEnd);
            if (snapshot.live(System.currentTimeMillis())) {
                badge = ctx.getString(R.string.widget_now);
            }
        }

        RemoteViews views = WidgetSurface.frame(ctx, R.layout.widget_small);
        WidgetSurface.fill(ctx, views, ctx.getString(R.string.widget_next_title),
                big, kicker, badge);
        WidgetSurface.open(ctx, views);
        manager.updateAppWidget(id, views);
    }
}
