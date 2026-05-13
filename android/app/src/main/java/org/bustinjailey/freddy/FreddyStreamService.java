package org.bustinjailey.freddy;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.provider.Settings;
import android.util.Log;

import androidx.annotation.Nullable;
import androidx.core.app.NotificationCompat;

import java.util.concurrent.TimeUnit;

import okhttp3.OkHttpClient;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.sse.EventSource;
import okhttp3.sse.EventSourceListener;
import okhttp3.sse.EventSources;

import org.json.JSONObject;

/**
 * Long-lived foreground service that holds an SSE connection to Freddy's /api/stream and posts a
 * high-priority local notification (on a DND-bypass channel) whenever the server sends a "signal"
 * event. This is how an Android-only, sideloaded build can ring through silent / Focus / DND
 * without an FCM project — Android's *channel* does the DND bypassing, not the push payload.
 *
 * Lifecycle: started by FreddyStreamPlugin (from the WebView) with the identity + base URL.
 * Restarts on failure with exponential backoff. Stays sticky after process restart; the platform
 * launches us with a null intent in that case and we recover identity/baseUrl from disk.
 */
public class FreddyStreamService extends Service {
    private static final String TAG = "FreddyStream";

    public static final String CHANNEL_STATUS = "freddy-status"; // low-importance "Freddy is listening" pin
    public static final String CHANNEL_ALERTS = "freddy-alerts"; // high-importance, DND-bypass, alarm-volume
    public static final int NOTIF_ID_STATUS = 1;
    public static final int NOTIF_ID_ALERT_BASE = 100; // signal notifications use base+attempt

    public static final String EXTRA_IDENTITY = "identity";
    public static final String EXTRA_BASE_URL = "baseUrl";
    public static final String ACTION_START = "org.bustinjailey.freddy.START";
    public static final String ACTION_STOP = "org.bustinjailey.freddy.STOP";

    private static final String PREFS = "freddy_stream";
    private static final String KEY_IDENTITY = "identity";
    private static final String KEY_BASE_URL = "baseUrl";

    private static final long MIN_BACKOFF_MS = 2_000;
    private static final long MAX_BACKOFF_MS = 60_000;

    private final Handler handler = new Handler(Looper.getMainLooper());
    private OkHttpClient http;
    private EventSource currentSource;
    private long backoffMs = MIN_BACKOFF_MS;
    private String identity;
    private String baseUrl;
    private boolean running;

    @Override
    public void onCreate() {
        super.onCreate();
        ensureChannels();
        // OkHttp uses 0 (no timeout) on reads by default but is more pedantic about idle conns.
        // Long read timeout fits SSE; we layer our own heartbeat / reconnect on top of that.
        http = new OkHttpClient.Builder()
                .connectTimeout(15, TimeUnit.SECONDS)
                .readTimeout(0, TimeUnit.MILLISECONDS) // SSE is a long-lived stream
                .pingInterval(30, TimeUnit.SECONDS)
                .retryOnConnectionFailure(true)
                .build();
    }

    @Override
    public int onStartCommand(@Nullable Intent intent, int flags, int startId) {
        if (intent != null && ACTION_STOP.equals(intent.getAction())) {
            stopStreaming();
            stopForeground(STOP_FOREGROUND_REMOVE);
            stopSelf();
            return START_NOT_STICKY;
        }

        // Sticky restart -> intent is null; recover the last identity/baseUrl from prefs.
        if (intent != null) {
            String i = intent.getStringExtra(EXTRA_IDENTITY);
            String u = intent.getStringExtra(EXTRA_BASE_URL);
            if (i != null && u != null) {
                identity = i;
                baseUrl = u;
                getSharedPreferences(PREFS, MODE_PRIVATE).edit()
                        .putString(KEY_IDENTITY, i).putString(KEY_BASE_URL, u).apply();
            }
        }
        if (identity == null || baseUrl == null) {
            var p = getSharedPreferences(PREFS, MODE_PRIVATE);
            identity = p.getString(KEY_IDENTITY, null);
            baseUrl = p.getString(KEY_BASE_URL, null);
        }
        if (identity == null || baseUrl == null) {
            Log.w(TAG, "no identity/baseUrl; nothing to stream");
            stopSelf();
            return START_NOT_STICKY;
        }

        startForegroundCompat(buildStatusNotification("Listening for " + identity + "…"));
        if (!running) {
            running = true;
            connect();
        }
        return START_STICKY;
    }

    @Nullable
    @Override
    public IBinder onBind(Intent intent) {
        return null;
    }

    @Override
    public void onDestroy() {
        stopStreaming();
        super.onDestroy();
    }

    // ------------------------------------------------------------------
    // SSE connection
    // ------------------------------------------------------------------

    private void connect() {
        String url = baseUrl.replaceAll("/+$", "") + "/api/stream?identity=" + Uri.encode(identity);
        Log.i(TAG, "connecting -> " + url);
        Request req = new Request.Builder()
                .url(url)
                .header("Accept", "text/event-stream")
                .header("Cache-Control", "no-cache")
                .build();
        currentSource = EventSources.createFactory(http).newEventSource(req, new Listener());
    }

    private void stopStreaming() {
        running = false;
        handler.removeCallbacksAndMessages(null);
        if (currentSource != null) {
            try { currentSource.cancel(); } catch (Exception ignored) {}
            currentSource = null;
        }
    }

    private void scheduleReconnect() {
        if (!running) return;
        long delay = backoffMs;
        backoffMs = Math.min(backoffMs * 2, MAX_BACKOFF_MS);
        Log.i(TAG, "scheduling reconnect in " + delay + "ms");
        handler.postDelayed(this::connect, delay);
    }

    private class Listener extends EventSourceListener {
        @Override
        public void onOpen(EventSource source, Response response) {
            Log.i(TAG, "stream open");
            backoffMs = MIN_BACKOFF_MS;
            updateStatus("Listening for " + identity + "…");
        }

        @Override
        public void onEvent(EventSource source, @Nullable String id, @Nullable String type, String data) {
            if (!"signal".equals(type)) return; // "hello" + heartbeat comments are ignored here
            try {
                JSONObject j = new JSONObject(data);
                postAlert(j);
            } catch (Exception e) {
                Log.w(TAG, "bad signal payload", e);
            }
        }

        @Override
        public void onClosed(EventSource source) {
            Log.i(TAG, "stream closed");
            updateStatus("Reconnecting…");
            scheduleReconnect();
        }

        @Override
        public void onFailure(EventSource source, @Nullable Throwable t, @Nullable Response response) {
            Log.w(TAG, "stream failed: " + (t != null ? t.getMessage() : response));
            updateStatus("Reconnecting…");
            scheduleReconnect();
        }
    }

    // ------------------------------------------------------------------
    // Notifications
    // ------------------------------------------------------------------

    private void postAlert(JSONObject j) {
        String title = j.optString("title", "Freddy");
        String body = j.optString("body", "");
        int attempt = j.optInt("attempt", 0);
        boolean isRequest = !"all-good".equals(j.optString("signal"));

        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent();
        open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        PendingIntent contentPI = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);

        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL_ALERTS)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle(title)
                .setContentText(body)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
                .setContentIntent(contentPI)
                .setAutoCancel(true)
                .setCategory(NotificationCompat.CATEGORY_CALL)
                .setPriority(NotificationCompat.PRIORITY_MAX)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                .setDefaults(NotificationCompat.DEFAULT_ALL);

        // For "request" signals, mark as ongoing-call-style so it bypasses DND and rings at
        // alarm volume — combined with the channel's setBypassDnd(true) and USAGE_ALARM sound.
        if (isRequest) {
            b.setOngoing(false); // user can dismiss
            b.setFullScreenIntent(contentPI, true);
        }

        // Re-fire same id within a "request" so escalation nudges replace, not stack.
        int id = NOTIF_ID_ALERT_BASE + j.optString("signal", "x").hashCode() % 1000;
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(id, b.build());
    }

    private Notification buildStatusNotification(String text) {
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        if (open == null) open = new Intent();
        PendingIntent pi = PendingIntent.getActivity(this, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        return new NotificationCompat.Builder(this, CHANNEL_STATUS)
                .setSmallIcon(android.R.drawable.ic_dialog_info)
                .setContentTitle("Freddy")
                .setContentText(text)
                .setContentIntent(pi)
                .setOngoing(true)
                .setPriority(NotificationCompat.PRIORITY_MIN)
                .setShowWhen(false)
                .build();
    }

    private void updateStatus(String text) {
        NotificationManager nm = getSystemService(NotificationManager.class);
        nm.notify(NOTIF_ID_STATUS, buildStatusNotification(text));
    }

    private void startForegroundCompat(Notification n) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.UPSIDE_DOWN_CAKE) {
            startForeground(NOTIF_ID_STATUS, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
        } else {
            startForeground(NOTIF_ID_STATUS, n);
        }
    }

    private void ensureChannels() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);

        // Low-importance "Freddy is listening" channel — the foreground notification pinning the
        // service. Suppress sound/vibration; the user shouldn't notice it.
        NotificationChannel status = new NotificationChannel(
                CHANNEL_STATUS, "Freddy status", NotificationManager.IMPORTANCE_MIN);
        status.setDescription("Indicates Freddy is listening for alerts.");
        status.setShowBadge(false);
        nm.createNotificationChannel(status);

        // High-importance, DND-bypass, alarm-volume "alerts" channel. setBypassDnd(true) is only
        // honored if the user has granted Notification Policy access (the plugin opens that
        // settings screen if it isn't granted yet). Alarm USAGE makes the sound play at alarm
        // volume regardless of the ringer switch.
        NotificationChannel alerts = new NotificationChannel(
                CHANNEL_ALERTS, "Freddy alerts", NotificationManager.IMPORTANCE_HIGH);
        alerts.setDescription("Need you / Diaper / Bottle pings — rings through silent and DND.");
        alerts.enableVibration(true);
        alerts.setVibrationPattern(new long[] { 0, 400, 200, 400, 200, 600 });
        alerts.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        alerts.setBypassDnd(true);
        AudioAttributes aa = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        Uri alarm = Settings.System.DEFAULT_ALARM_ALERT_URI;
        if (alarm == null) alarm = Settings.System.DEFAULT_NOTIFICATION_URI;
        alerts.setSound(alarm, aa);
        nm.createNotificationChannel(alerts);
    }
}
