# Push notification deployment

The application code and database queue are intentionally separate from remote delivery. A failed push request cannot roll back a trade, waiver, announcement or draft operation.

## 1. Deploy the database migration

Deploy `20260816170000_android_push_notifications.sql` through the normal linked Supabase migration process.

## 2. Deploy the sender

```powershell
npx supabase functions deploy send-push-notification --no-verify-jwt --use-api
```

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are supplied automatically to a deployed Edge Function. If Enhanced Push Security is enabled in Expo, create an Expo access token and add it as the `EXPO_ACCESS_TOKEN` Supabase function secret.

## 3. Add the asynchronous database webhook

In Supabase Dashboard, open **Database Webhooks** and create:

- Name: `deliver-user-push-notification`
- Table: `public.user_notifications`
- Event: `INSERT`
- Type: Supabase Edge Function
- Function: `send-push-notification`
- Method: `POST`
- Authentication: add the service-role authorization header using the Dashboard control

The Edge Function rejects requests that are not authenticated with the project service-role key. Never place that key in application code.

## 4. Configure Android delivery credentials

Configure the Expo project with Android FCM v1 credentials through EAS. Then create a fresh APK because notification credentials and native configuration are part of the installed application.

## 5. Test

On a physical Android device:

1. Install the new APK.
2. Open **Notifications → Settings**.
3. Enable **Push notifications** and accept the Android permission request.
4. Select **Send a test notification**.
5. Lock the phone or background the app and confirm delivery.
6. Tap the notification and confirm that the app opens the notification centre.

Then test one trade offer, one waiver outcome, one commissioner announcement and a draft waiting-room reminder. Chronicle notifications remain in-app only.

