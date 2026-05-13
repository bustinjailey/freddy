package org.bustinjailey.freddy;

import android.Manifest;
import android.app.NotificationManager;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.ContextCompat;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * Capacitor plugin bridging the SvelteKit WebView <-> FreddyStreamService. Two responsibilities:
 *
 *   1. start/stop the foreground service that holds the SSE connection.
 *   2. request the runtime permissions DND-bypass needs (POST_NOTIFICATIONS on Android 13+,
 *      and the Notification Policy access settings screen which the user grants by hand).
 *
 * No FCM, no Firebase — the whole delivery channel is our own SSE + a local alert channel.
 */
@CapacitorPlugin(
    name = "FreddyStream",
    permissions = {
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notifications")
    }
)
public class FreddyStreamPlugin extends Plugin {

    @PluginMethod
    public void start(PluginCall call) {
        String identity = call.getString("identity");
        String baseUrl = call.getString("baseUrl");
        if (identity == null || identity.isEmpty() || baseUrl == null || baseUrl.isEmpty()) {
            call.reject("identity and baseUrl required");
            return;
        }
        Context ctx = getContext();
        Intent svc = new Intent(ctx, FreddyStreamService.class)
                .setAction(FreddyStreamService.ACTION_START)
                .putExtra(FreddyStreamService.EXTRA_IDENTITY, identity)
                .putExtra(FreddyStreamService.EXTRA_BASE_URL, baseUrl);
        ContextCompat.startForegroundService(ctx, svc);

        JSObject result = new JSObject();
        result.put("started", true);
        result.put("notificationPermission", hasNotificationsPermission());
        result.put("dndPolicyGranted", hasDndAccess());
        call.resolve(result);
    }

    @PluginMethod
    public void stop(PluginCall call) {
        Context ctx = getContext();
        Intent svc = new Intent(ctx, FreddyStreamService.class)
                .setAction(FreddyStreamService.ACTION_STOP);
        ctx.startService(svc);
        call.resolve();
    }

    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        r.put("notificationPermission", hasNotificationsPermission());
        r.put("dndPolicyGranted", hasDndAccess());
        call.resolve(r);
    }

    /**
     * Ask for POST_NOTIFICATIONS at runtime if Android 13+, then resolve with the new state. The
     * Capacitor framework handles the actual dialog via the @Permission annotation; we just
     * trigger the request flow.
     */
    @PluginMethod
    public void requestNotificationPermission(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        if (hasNotificationsPermission()) {
            JSObject r = new JSObject();
            r.put("granted", true);
            call.resolve(r);
            return;
        }
        requestPermissionForAlias("notifications", call, "notifPermissionCallback");
    }

    /**
     * Pop the system "Notification policy access" settings screen so the user can grant DND
     * bypass. There's no programmatic way to grant this — it has to be a manual toggle.
     */
    @PluginMethod
    public void openDndSettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_NOTIFICATION_POLICY_ACCESS_SETTINGS)
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    /** Optional: open the per-app battery-optimisation screen so the user can mark Freddy
     *  "Unrestricted" — otherwise aggressive OEMs (Samsung, Xiaomi) will kill the FGS overnight. */
    @PluginMethod
    public void openBatterySettings(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
                .setData(Uri.fromParts("package", getContext().getPackageName(), null))
                .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        getContext().startActivity(i);
        call.resolve();
    }

    @com.getcapacitor.annotation.PermissionCallback
    private void notifPermissionCallback(PluginCall call) {
        JSObject r = new JSObject();
        r.put("granted", hasNotificationsPermission());
        call.resolve(r);
    }

    // -----------------------------------------------------------------

    private boolean hasNotificationsPermission() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.TIRAMISU) return true;
        return ContextCompat.checkSelfPermission(getContext(), Manifest.permission.POST_NOTIFICATIONS)
                == PackageManager.PERMISSION_GRANTED;
    }

    private boolean hasDndAccess() {
        NotificationManager nm = (NotificationManager) getContext().getSystemService(Context.NOTIFICATION_SERVICE);
        return nm != null && nm.isNotificationPolicyAccessGranted();
    }
}
