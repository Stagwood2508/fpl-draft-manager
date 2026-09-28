const {
  withAndroidManifest,
  withDangerousMod,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_CLASS = '.tradeactions.TradeActionMessagingService';
const RECEIVER_CLASS = '.tradeactions.TradeActionReceiver';

const withTradePushActions = config => {
  config = withAndroidManifest(config, configWithManifest => {
    const application = configWithManifest.modResults.manifest.application?.[0];
    if (!application) return configWithManifest;

    const hasComponent = (components, className) => (components || []).some(component =>
      component.$?.['android:name'] === className,
    );

    if (!hasComponent(application.service, SERVICE_CLASS)) {
      application.service = application.service || [];
      application.service.push({
        $: { 'android:name': SERVICE_CLASS, 'android:exported': 'false' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'com.google.firebase.MESSAGING_EVENT' } }] }],
      });
    }

    if (!hasComponent(application.receiver, RECEIVER_CLASS)) {
      application.receiver = application.receiver || [];
      application.receiver.push({
        $: { 'android:name': RECEIVER_CLASS, 'android:exported': 'false' },
      });
    }
    return configWithManifest;
  });

  return withDangerousMod(config, ['android', async configWithAndroid => {
    const packageName = configWithAndroid.android.package;
    if (!packageName) throw new Error('Android package must be configured for trade notification actions.');
    const sourceDirectory = path.join(
      configWithAndroid.modRequest.platformProjectRoot,
      'app', 'src', 'main', 'java', ...packageName.split('.'), 'tradeactions',
    );
    fs.mkdirSync(sourceDirectory, { recursive: true });
    fs.writeFileSync(path.join(sourceDirectory, 'TradeActionMessagingService.java'), messagingService(packageName));
    fs.writeFileSync(path.join(sourceDirectory, 'TradeActionReceiver.java'), actionReceiver(packageName));
    return configWithAndroid;
  }]);
};

function messagingService(packageName) {
  return `package ${packageName}.tradeactions;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import expo.modules.notifications.service.ExpoFirebaseMessagingService;
import com.google.firebase.messaging.RemoteMessage;
import java.util.Map;

public final class TradeActionMessagingService extends ExpoFirebaseMessagingService {
  private static final String CHANNEL_ID = "league-events";

  @Override public void onMessageReceived(RemoteMessage message) {
    Map<String, String> data = message.getData();
    if (!"trade-action".equals(data.get("kind"))) {
      super.onMessageReceived(message);
      return;
    }
    String acceptToken = data.get("acceptToken");
    String rejectToken = data.get("rejectToken");
    String endpoint = data.get("actionEndpoint");
    if (acceptToken == null || rejectToken == null || endpoint == null) return;

    createChannel();
    int notificationId;
    try { notificationId = Integer.parseInt(data.get("notificationId")); }
    catch (Exception ignored) { notificationId = (int) (System.currentTimeMillis() & 0xfffffff); }

    Intent openIntent = getPackageManager().getLaunchIntentForPackage(getPackageName());
    PendingIntent contentIntent = openIntent == null ? null : PendingIntent.getActivity(
      this, notificationId, openIntent,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
    );
    NotificationCompat.Builder builder = new NotificationCompat.Builder(this, CHANNEL_ID)
      .setSmallIcon(getApplicationInfo().icon)
      .setContentTitle(valueOr(data.get("title"), "Trade offer"))
      .setContentText(valueOr(data.get("body"), "Review this trade offer."))
      .setStyle(new NotificationCompat.BigTextStyle().bigText(valueOr(data.get("body"), "Review this trade offer.")))
      .setPriority(NotificationCompat.PRIORITY_HIGH)
      .setAutoCancel(true)
      .setOnlyAlertOnce(false);
    if (contentIntent != null) builder.setContentIntent(contentIntent);
    builder.addAction(0, "Accept", actionIntent(notificationId, endpoint, acceptToken, "ACCEPT"));
    builder.addAction(0, "Reject", actionIntent(notificationId + 1, endpoint, rejectToken, "REJECT"));
    ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(notificationId, builder.build());
  }

  private PendingIntent actionIntent(int requestCode, String endpoint, String token, String action) {
    Intent intent = new Intent(this, TradeActionReceiver.class);
    intent.putExtra("endpoint", endpoint);
    intent.putExtra("token", token);
    intent.putExtra("action", action);
    return PendingIntent.getBroadcast(this, requestCode, intent,
      PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
  }

  private void createChannel() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
    NotificationManager manager = getSystemService(NotificationManager.class);
    NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "League events", NotificationManager.IMPORTANCE_HIGH);
    channel.setDescription("Trade offers, waiver outcomes, announcements and draft reminders.");
    manager.createNotificationChannel(channel);
  }

  private static String valueOr(String value, String fallback) { return value == null || value.trim().isEmpty() ? fallback : value; }
}`;
}

function actionReceiver(packageName) {
  return `package ${packageName}.tradeactions;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class TradeActionReceiver extends BroadcastReceiver {
  private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

  @Override public void onReceive(Context context, Intent intent) {
    final PendingResult pending = goAsync();
    final Context appContext = context.getApplicationContext();
    final String endpoint = intent.getStringExtra("endpoint");
    final String token = intent.getStringExtra("token");
    final String action = intent.getStringExtra("action");
    EXECUTOR.execute(() -> {
      String message;
      try {
        if (endpoint == null || token == null || !endpoint.startsWith("https://")) throw new IllegalArgumentException();
        HttpURLConnection connection = (HttpURLConnection) new URL(endpoint).openConnection();
        connection.setRequestMethod("POST");
        connection.setConnectTimeout(8000);
        connection.setReadTimeout(8000);
        connection.setRequestProperty("Content-Type", "application/json");
        connection.setDoOutput(true);
        byte[] payload = new JSONObject().put("token", token).toString().getBytes(StandardCharsets.UTF_8);
        try (OutputStream output = connection.getOutputStream()) { output.write(payload); }
        int status = connection.getResponseCode();
        message = status >= 200 && status < 300
          ? "ACCEPT".equals(action) ? "Trade accepted" : "Trade rejected"
          : "This trade is no longer available";
        connection.disconnect();
      } catch (Exception ignored) {
        message = "Could not update the trade";
      } finally {
        final String toast = message;
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(appContext, toast, Toast.LENGTH_SHORT).show());
        pending.finish();
      }
    });
  }
}`;
}

module.exports = createRunOncePlugin(withTradePushActions, 'with-trade-push-actions', '1.0.0');
