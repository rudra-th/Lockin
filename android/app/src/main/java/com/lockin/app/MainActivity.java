package com.lockin.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

import org.json.JSONObject;

/**
 * The shell. It registers the small LockinNative bridge and remembers a route
 * requested by a tapped notification or Quick Settings tile, so a cold start
 * still lands on the right screen.
 */
public class MainActivity extends BridgeActivity {

    private static String pendingRoute = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(LockinNativePlugin.class);
        super.onCreate(savedInstanceState);
        captureRoute(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        setIntent(intent);
        captureRoute(intent);
    }

    /** A notification or tile tap asks for a screen. Warm starts get an event too. */
    private void captureRoute(Intent intent) {
        if (intent == null) return;

        String alarmAction = intent.getStringExtra("alarmAction");
        if (alarmAction != null && !alarmAction.isEmpty()) {
            queueAlarmAction(intent, alarmAction);
            intent.removeExtra("alarmAction");
        }

        String route = intent.getStringExtra("openRoute");
        if (route == null && intent.getBooleanExtra("openSchedule", false)) route = "/schedule";
        if (route == null || route.isEmpty() || route.charAt(0) != '/') return;

        intent.removeExtra("openSchedule");
        intent.removeExtra("openRoute");
        pendingRoute = route;

        if (bridge == null || bridge.getWebView() == null) return;
        String js = "window.dispatchEvent(new CustomEvent('lockin:native-route',{detail:"
                + JSONObject.quote(route) + "}))";
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(js, null));
    }

    /** Hand an alarm action to the queue the web bridge drains. */
    private void queueAlarmAction(Intent intent, String action) {
        try {
            org.json.JSONObject row = new org.json.JSONObject();
            row.put("action", action);
            row.put("scheduleId", intent.getStringExtra("scheduleId"));
            row.put("day", intent.getStringExtra("day"));
            row.put("name", intent.getStringExtra("name"));
            row.put("startAt", intent.getLongExtra("startAt", 0L));
            row.put("endAt", intent.getLongExtra("endAt", 0L));
            AlarmActions.push(this, row);
        } catch (org.json.JSONException ignored) {
            return;
        }

        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('lockin:alarm-action'))",
                null));
    }

    /** Called once by the plugin on web boot; clears the pending route. */
    static String consumeRoute() {
        String route = pendingRoute;
        pendingRoute = null;
        return route;
    }
}
