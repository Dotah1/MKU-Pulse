package com.mku.pulse;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Context;
import android.os.Build;

import androidx.annotation.NonNull;
import androidx.annotation.RequiresPermission;

/**
 * Receives notifications delegated from Chrome and posts them through an
 * app-owned high-importance channel. Android still owns the final user
 * setting, so a user can turn banners off after the channel is created.
 */
public class DelegationService extends
        com.google.androidbrowserhelper.trusted.DelegationService {
    private static final String CHANNEL_ID = "mku_pulse_alerts";
    private static final String CHANNEL_NAME = "MKU Pulse Alerts";

    @Override
    public void onCreate() {
        super.onCreate();
        createHighImportanceChannel();
    }

    @RequiresPermission(android.Manifest.permission.POST_NOTIFICATIONS)
    @Override
    public boolean onNotifyNotificationWithChannel(
            @NonNull String platformTag,
            int platformId,
            @NonNull Notification notification,
            @NonNull String channelName) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            return super.onNotifyNotificationWithChannel(
                    platformTag, platformId, notification, channelName);
        }

        createHighImportanceChannel();
        Notification.Builder builder = Notification.Builder.recoverBuilder(this, notification);
        builder.setChannelId(CHANNEL_ID);
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return false;
        manager.notify(platformTag, platformId, builder.build());
        return true;
    }

    private void createHighImportanceChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager manager =
                (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null || manager.getNotificationChannel(CHANNEL_ID) != null) return;
        manager.createNotificationChannel(new NotificationChannel(
                CHANNEL_ID,
                CHANNEL_NAME,
                NotificationManager.IMPORTANCE_HIGH));
    }
}
