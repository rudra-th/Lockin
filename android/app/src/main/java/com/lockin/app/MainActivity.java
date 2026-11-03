package com.lockin.app;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

/**
 * The shell. It registers the small LockinNative bridge and remembers a route
 * requested by a tapped notification, so a cold start still lands on Schedule.
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

    /** A notification tap asks for Schedule. Warm starts get an event too. */
    private void captureRoute(Intent intent) {
        if (intent == null || !intent.getBooleanExtra("openSchedule", false)) return;
        intent.removeExtra("openSchedule");
        pendingRoute = "/schedule";

        if (bridge == null || bridge.getWebView() == null) return;
        bridge.getWebView().post(() -> bridge.getWebView().evaluateJavascript(
                "window.dispatchEvent(new CustomEvent('lockin:native-route',{detail:'/schedule'}))",
                null));
    }

    /** Called once by the plugin on web boot; clears the pending route. */
    static String consumeRoute() {
        String route = pendingRoute;
        pendingRoute = null;
        return route;
    }
}
