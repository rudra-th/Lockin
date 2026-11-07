package com.lockin.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

/** Seven days of focus time, plus how many days reached the target. */
public class WeekWidgetProvider extends AppWidgetProvider {

    static void refreshAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        ComponentName provider = new ComponentName(ctx, WeekWidgetProvider.class);
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
        if (snapshot.updatedAt == 0) {
            big = "\u2014";
            kicker = ctx.getString(R.string.widget_unset);
            badge = "";
        } else {
            big = WidgetStore.duration(snapshot.weekMinutes);
            kicker = ctx.getString(R.string.widget_week_caption);
            badge = ctx.getString(R.string.widget_week_days, snapshot.weekMetDays);
        }

        RemoteViews views = WidgetSurface.frame(ctx, R.layout.widget_small);
        WidgetSurface.fill(ctx, views, ctx.getString(R.string.widget_week_title),
                big, kicker, badge);
        WidgetSurface.open(ctx, views);
        manager.updateAppWidget(id, views);
    }
}
