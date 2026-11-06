package com.lockin.app;

import android.app.PendingIntent;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.service.quicksettings.Tile;
import android.service.quicksettings.TileService;

/**
 * The Quick Settings tile: one tap opens Study Mode's setup screen. It never
 * starts a session on its own — the hold on the ring is the consent, and the
 * tile must not skip it.
 */
public class FocusTileService extends TileService {

    /** Ask the shade to rebind the tile after the app pushed new numbers. */
    static void requestUpdate(Context ctx) {
        try {
            requestListeningState(ctx, new ComponentName(ctx, FocusTileService.class));
        } catch (RuntimeException ignored) {
            /* the tile is not placed, or the shade is not running */
        }
    }

    @Override
    public void onStartListening() {
        paint();
    }

    @Override
    public void onTileAdded() {
        paint();
    }

    @SuppressWarnings("deprecation")
    @Override
    public void onClick() {
        Intent intent = new Intent(this, MainActivity.class);
        intent.putExtra("openRoute", "/focus");
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            PendingIntent pending = PendingIntent.getActivity(this, 1, intent,
                    PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            startActivityAndCollapse(pending);
        } else {
            startActivityAndCollapse(intent);
        }
    }

    private void paint() {
        Tile tile = getQsTile();
        if (tile == null) return;

        WidgetStore.Snapshot snapshot = WidgetStore.read(this);
        boolean live = snapshot.live(System.currentTimeMillis());

        tile.setState(live ? Tile.STATE_ACTIVE : Tile.STATE_INACTIVE);
        tile.setLabel(getString(R.string.tile_label));

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
            String detail;
            if (live) {
                detail = getString(R.string.tile_live);
            } else if (snapshot.met()) {
                detail = WidgetStore.duration(snapshot.minutes) + " · " + getString(R.string.widget_met);
            } else if (snapshot.updatedAt == 0) {
                detail = getString(R.string.tile_empty);
            } else {
                detail = WidgetStore.duration(snapshot.minutes) + " of "
                        + WidgetStore.duration(snapshot.goal);
            }
            tile.setSubtitle(detail);
        }

        tile.updateTile();
    }
}
