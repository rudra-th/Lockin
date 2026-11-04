package com.lockin.app;

import android.content.Intent;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.View;
import android.view.WindowManager;
import android.widget.TextView;

import androidx.annotation.Nullable;
import androidx.appcompat.app.AppCompatActivity;
import androidx.core.app.NotificationManagerCompat;

import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

/**
 * The full-screen half of a schedule alarm. The system launches this over the
 * lock screen when the full-screen intent is allowed; otherwise the same alarm
 * arrives as a heads-up notification and this activity never appears.
 *
 * It owns no schedule state: the title, body and notification id arrive in the
 * intent. Dismiss clears the notification; Open Lockin lands on Schedule.
 */
public class AlarmActivity extends AppCompatActivity {

    private final Handler ticker = new Handler(Looper.getMainLooper());
    private final SimpleDateFormat clockFormat = new SimpleDateFormat("HH:mm", Locale.getDefault());
    private String alarmId = "lockin-alarm";

    private final Runnable tick = new Runnable() {
        @Override
        public void run() {
            TextView clock = findViewById(R.id.alarm_clock);
            if (clock != null) clock.setText(clockFormat.format(new Date()));
            ticker.postDelayed(this, 1000);
        }
    };

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showOverLockScreen();
        setContentView(R.layout.activity_alarm);

        Intent intent = getIntent();
        String id = intent.getStringExtra("id");
        if (id != null && !id.isEmpty()) alarmId = id;
        String title = intent.getStringExtra("title");
        if (title == null || title.isEmpty()) title = getString(R.string.alarm_default_title);
        String body = intent.getStringExtra("body");

        ((TextView) findViewById(R.id.alarm_title)).setText(title);
        TextView bodyView = findViewById(R.id.alarm_body);
        if (body == null || body.isEmpty()) {
            bodyView.setVisibility(View.GONE);
        } else {
            bodyView.setText(body);
        }

        findViewById(R.id.alarm_dismiss).setOnClickListener(v -> dismiss());
        findViewById(R.id.alarm_open).setOnClickListener(v -> openApp());
    }

    /** Turn the screen on and draw above the keyguard without unlocking it. */
    private void showOverLockScreen() {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
            setShowWhenLocked(true);
            setTurnScreenOn(true);
        } else {
            getWindow().addFlags(
                    WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED
                            | WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON);
        }
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    }

    @Override
    protected void onStart() {
        super.onStart();
        ticker.post(tick);
    }

    @Override
    protected void onStop() {
        ticker.removeCallbacks(tick);
        super.onStop();
    }

    private void dismiss() {
        NotificationManagerCompat.from(this).cancel(alarmId.hashCode());
        finish();
    }

    private void openApp() {
        NotificationManagerCompat.from(this).cancel(alarmId.hashCode());
        Intent open = new Intent(this, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        open.putExtra("openSchedule", true);
        startActivity(open);
        finish();
    }

    @Override
    public void onBackPressed() {
        dismiss();
    }
}
