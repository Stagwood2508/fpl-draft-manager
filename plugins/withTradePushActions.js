const {
  withAndroidManifest,
  withAppBuildGradle,
  withDangerousMod,
  createRunOncePlugin,
} = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const SERVICE_CLASS = '.tradeactions.TradeActionMessagingService';
const RECEIVER_CLASS = '.tradeactions.TradeActionReceiver';
const CONFIRMATION_ACTIVITY_CLASS = '.tradeactions.TradeActionConfirmationActivity';

const withTradePushActions = config => {
  config = withAppBuildGradle(config, configWithGradle => {
    const dependency = "implementation 'com.google.firebase:firebase-messaging:25.0.1'";
    if (!configWithGradle.modResults.contents.includes('com.google.firebase:firebase-messaging')) {
      configWithGradle.modResults.contents = configWithGradle.modResults.contents.replace(
        /dependencies\s*\{/,
        match => `${match}\n    ${dependency}`,
      );
    }
    return configWithGradle;
  });

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

    if (!hasComponent(application.activity, CONFIRMATION_ACTIVITY_CLASS)) {
      application.activity = application.activity || [];
      application.activity.push({
        $: { 'android:name': CONFIRMATION_ACTIVITY_CLASS, 'android:exported': 'false' },
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
    fs.writeFileSync(path.join(sourceDirectory, 'TradeActionConfirmationActivity.java'), confirmationActivity(packageName));
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
    builder.addAction(0, "Accept", confirmationIntent(notificationId, notificationId, endpoint, acceptToken, "ACCEPT"));
    builder.addAction(0, "Reject", confirmationIntent(notificationId + 1, notificationId, endpoint, rejectToken, "REJECT"));
    ((NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE)).notify(notificationId, builder.build());
  }

  private PendingIntent confirmationIntent(int requestCode, int notificationId, String endpoint, String token, String action) {
    // Notification actions launch this Activity directly. Starting an Activity
    // from a background BroadcastReceiver is restricted on current Android.
    Intent intent = new Intent(this, TradeActionConfirmationActivity.class);
    intent.putExtra("notificationId", notificationId);
    intent.putExtra("endpoint", endpoint);
    intent.putExtra("token", token);
    intent.putExtra("action", action);
    intent.addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
    return PendingIntent.getActivity(this, requestCode, intent,
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
import android.app.NotificationManager;
import android.os.Handler;
import android.os.Looper;
import android.widget.Toast;
import org.json.JSONObject;
import java.io.OutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.io.ByteArrayOutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

public final class TradeActionReceiver extends BroadcastReceiver {
  private static final ExecutorService EXECUTOR = Executors.newSingleThreadExecutor();

  @Override public void onReceive(Context context, Intent intent) {
    if (!intent.getBooleanExtra("confirmed", false)) {
      Intent confirmation = new Intent(context, TradeActionConfirmationActivity.class);
      confirmation.putExtra("endpoint", intent.getStringExtra("endpoint"));
      confirmation.putExtra("token", intent.getStringExtra("token"));
      confirmation.putExtra("action", intent.getStringExtra("action"));
      confirmation.putExtra("notificationId", intent.getIntExtra("notificationId", -1));
      confirmation.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
      context.startActivity(confirmation);
      return;
    }

    final PendingResult pending = goAsync();
    final Context appContext = context.getApplicationContext();
    final String endpoint = intent.getStringExtra("endpoint");
    final String token = intent.getStringExtra("token");
    final String action = intent.getStringExtra("action");
    final int notificationId = intent.getIntExtra("notificationId", -1);
    EXECUTOR.execute(() -> {
      String message = "Could not update the trade";
      boolean completed = false;
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
        String response = readBody(status >= 200 && status < 300
          ? connection.getInputStream() : connection.getErrorStream());
        completed = status >= 200 && status < 300
          && new JSONObject(response).optBoolean("success", false);
        message = completed
          ? "ACCEPT".equals(action) ? "Trade accepted" : "Trade rejected"
          : failureMessage(response);
        connection.disconnect();
      } catch (Exception ignored) {
        message = "Could not update the trade";
      } finally {
        if (completed && notificationId >= 0) {
          NotificationManager manager = (NotificationManager) appContext.getSystemService(Context.NOTIFICATION_SERVICE);
          if (manager != null) manager.cancel(notificationId);
        }
        final String toast = message;
        new Handler(Looper.getMainLooper()).post(() -> Toast.makeText(appContext, toast, Toast.LENGTH_SHORT).show());
        pending.finish();
      }
    });
  }

  private static String readBody(InputStream stream) throws Exception {
    if (stream == null) return "";
    try (InputStream input = stream; ByteArrayOutputStream output = new ByteArrayOutputStream()) {
      byte[] buffer = new byte[1024];
      int read;
      while ((read = input.read(buffer)) != -1) output.write(buffer, 0, read);
      return output.toString(StandardCharsets.UTF_8.name());
    }
  }

  private static String failureMessage(String response) {
    String error = "ACTION_UNAVAILABLE";
    try {
      error = new JSONObject(response).optString("error", error);
    } catch (Exception ignored) {
      // A non-JSON error body must not prevent the notification action from
      // completing or crash the receiver. Keep the safe generic message.
    }
    if ("ACTION_EXPIRED".equals(error)) return "This trade action has expired";
    if ("TRADE_IS_NO_LONGER_PENDING".equals(error) || "TRANSACTION_NOT_FOUND".equals(error)) return "This trade is no longer pending";
    if ("ONLY_RECEIVER_CAN_ACCEPT".equals(error) || "NOT_AUTHORIZED_FOR_TRADE_ACTION".equals(error)) return "This action is not assigned to this manager";
    if (error.startsWith("TRADE_WOULD_CREATE_INVALID")) return "Trade would leave an invalid squad";
    return "Trade update failed: " + error;
  }
}`;
}

function confirmationActivity(packageName) {
  return `package ${packageName}.tradeactions;

import android.app.Activity;
import android.app.AlertDialog;
import android.content.Intent;
import android.os.Bundle;

public final class TradeActionConfirmationActivity extends Activity {
  @Override protected void onCreate(Bundle savedInstanceState) {
    super.onCreate(savedInstanceState);

    final String endpoint = getIntent().getStringExtra("endpoint");
    final String token = getIntent().getStringExtra("token");
    final String action = getIntent().getStringExtra("action");
    final int notificationId = getIntent().getIntExtra("notificationId", -1);
    if (endpoint == null || token == null || (!"ACCEPT".equals(action) && !"REJECT".equals(action))) {
      finish();
      return;
    }

    final boolean accepting = "ACCEPT".equals(action);
    final String verb = accepting ? "Accept" : "Reject";
    new AlertDialog.Builder(this)
      .setTitle(verb + " trade?")
      .setMessage("Are you sure you want to " + verb.toLowerCase() + " this trade offer?")
      .setNegativeButton("Cancel", (dialog, which) -> finish())
      .setPositiveButton(verb, (dialog, which) -> {
        Intent confirmed = new Intent(this, TradeActionReceiver.class);
        confirmed.putExtra("endpoint", endpoint);
        confirmed.putExtra("token", token);
        confirmed.putExtra("action", action);
        confirmed.putExtra("notificationId", notificationId);
        confirmed.putExtra("confirmed", true);
        sendBroadcast(confirmed);
        finish();
      })
      .setOnCancelListener(dialog -> finish())
      .show();
  }
}`;
}

module.exports = createRunOncePlugin(withTradePushActions, 'with-trade-push-actions', '1.0.0');
