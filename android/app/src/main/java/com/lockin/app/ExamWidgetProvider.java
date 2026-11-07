package com.lockin.app;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.widget.RemoteViews;

/** A quiet countdown: days left until the exam set in the app. */
public class ExamWidgetProvider extends AppWidgetProvider {

    static void refreshAll(Context ctx) {
        AppWidgetManager manager = AppWidgetManager.getInstance(ctx);
        ComponentName provider = new ComponentName(ctx, ExamWidgetProvider.class);
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
        if (snapshot.examDays < 0 && snapshot.examName.isEmpty()) {
            big = "\u2014";
            kicker = ctx.getString(R.string.widget_exam_unset);
            badge = "";
        } else if (snapshot.examDays < 0) {
            big = "\u2014";
            kicker = snapshot.examName;
            badge = ctx.getString(R.string.widget_exam_passed);
        } else {
            big = String.valueOf(snapshot.examDays);
            kicker = snapshot.examName.isEmpty()
                    ? ctx.getString(R.string.widget_exam_days)
                    : snapshot.examName;
            if (snapshot.examDays == 0) {
                badge = ctx.getString(R.string.widget_exam_today);
            } else if (snapshot.examDays == 1) {
                badge = ctx.getString(R.string.widget_exam_tomorrow);
            } else {
                badge = snapshot.examWhen.isEmpty()
                        ? ctx.getString(R.string.widget_exam_days)
                        : snapshot.examWhen;
            }
        }

        RemoteViews views = WidgetSurface.frame(ctx, R.layout.widget_small);
        WidgetSurface.fill(ctx, views, ctx.getString(R.string.widget_exam_title),
                big, kicker, badge);
        WidgetSurface.open(ctx, views);
        manager.updateAppWidget(id, views);
    }
}
