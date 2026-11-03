# Google Slides for strategy decks: the one-time setup

For Lital, 3 Nov 2026. These steps let Socialytics make each client's strategy into a Moburst-branded Google Slides deck in ai@moburst.com's Drive. You do them once. Nobody does anything after that: each deck is a new copy, shared as editor with the person who asked, with no Google email.

Until these steps are done, the strategy page says "Google Slides is not connected yet. An admin connects it once in Settings." The PDF works the whole time.

What Socialytics asks Google for, and nothing more:
- `drive.file`: only the files Socialytics itself creates (its folder, its template and each deck). It cannot see anything else in ai@moburst.com's Drive. Google lists it as a non-sensitive scope.
- `openid` and `email`: to confirm the account that signed in is ai@moburst.com.

The sign-in is kept on the server in Supabase Vault. No screen, log or answer ever shows it.

## 1. A Google Cloud project with the two APIs

1. Open https://console.cloud.google.com signed in as **ai@moburst.com**.
2. In the project picker at the top, choose an existing project that belongs to the **moburst.com** organization, or click **New project**, name it `Socialytics`, and set **Location** to the moburst.com organization. (The organization matters: step 2 needs it.)
3. Go to **APIs & Services > Library**. Search for **Google Slides API** and click **Enable**. Then search for **Google Drive API** and click **Enable**.

## 2. The consent screen, as an Internal app

1. Go to **Google Auth Platform** (in older menus: **APIs & Services > OAuth consent screen**) and click **Get started**.
2. **App name**: `Socialytics`. **User support email**: ai@moburst.com. Click **Next**.
3. **Audience**: choose **Internal**. Click **Next**. (Internal means only moburst.com accounts can sign in. Internal apps skip Google's app verification, and their sign-in does not expire after 7 days the way an External app's does while it is in testing.)
4. **Contact information**: ai@moburst.com. Click **Next**, agree to the policy, and click **Create**.
5. Open **Data Access** and click **Add or remove scopes**. Tick these three, then click **Update** and **Save**:
   - `.../auth/drive.file`
   - `openid`
   - `.../auth/userinfo.email`

If **Internal** is greyed out, the project is not in the moburst.com organization. Go back to step 1.2.

## 3. The OAuth client

1. Open **Clients** (in older menus: **APIs & Services > Credentials > Create credentials > OAuth client ID**) and click **Create client**.
2. **Application type**: **Web application**. **Name**: `Socialytics strategy decks`.
3. Under **Authorized redirect URIs**, click **Add URI** and paste exactly:

   `https://rwouwxqggjjacbpbhqsn.supabase.co/functions/v1/google-auth`

4. Click **Create**. Google shows the **Client ID** and the **Client secret**. Download the JSON or keep the window open for the next step: the secret is shown in full only now.

## 4. The two secrets in Supabase

1. Open https://supabase.com/dashboard, the Socialytics project (`rwouwxqggjjacbpbhqsn`), then **Edge Functions > Secrets**.
2. Add two secrets, pasting the values from step 3 yourself:
   - Name `GOOGLE_OAUTH_CLIENT_ID`, value: the Client ID.
   - Name `GOOGLE_OAUTH_CLIENT_SECRET`, value: the Client secret.
3. Click **Save**. Do not paste either value in Slack, email or a chat.

## 5. If the Workspace restricts third-party apps

Internal apps from a project in the moburst.com organization are usually allowed. If the moburst.com Workspace blocks apps it has not reviewed, the Connect in step 6 ends on a Google page saying the app is blocked or needs admin approval. A Workspace super admin then trusts the app once:

1. Open https://admin.google.com signed in as a super admin.
2. Go to **Security > Access and data control > API controls**.
3. Under **App access control**, click **Manage Third-Party App Access**, then **Add app > OAuth App Name Or Client ID**.
4. Paste the **Client ID** from step 3, click **Search**, and select **Socialytics**.
5. Choose who it applies to: the whole moburst.com organization, or the organizational unit that holds ai@moburst.com. Click **Continue**.
6. Choose **Trusted: Can access all Google services**, click **Continue**, then **Finish**.

The change can take a few minutes to reach the sign-in page.

## 6. Connect in Socialytics

1. Open Socialytics, **Settings**, and find the **Google Slides** panel.
2. Click **Connect Google Slides**. Sign in as **ai@moburst.com** (not your own account), and click **Allow**.
3. Google sends you back to Settings. The panel reads **Connected as ai@moburst.com**.

The first deck anyone asks for creates a **Socialytics strategy decks** folder in ai@moburst.com's Drive and puts the Moburst template there (named "Socialytics strategy template (do not edit)"). Each deck after that is a copy in the same folder.

## If it ever stops working

Google drops a sign-in when the account's password changes or when access is removed in the Google account's security settings. Socialytics uses the sign-in once a week so it does not lapse from disuse. If it is dropped, the strategy page says Google Slides is not connected yet and the Settings panel says so too; do step 6 again. Nothing else needs redoing.

## Sources

- Google's web server OAuth flow: https://developers.google.com/identity/protocols/oauth2/web-server
- Drive scopes (`drive.file` is non-sensitive): https://developers.google.com/workspace/drive/api/guides/api-specific-auth
- Internal apps and verification: https://support.google.com/cloud/answer/13464323
- Refresh-token expiry: https://developers.google.com/identity/protocols/oauth2#expiration
- Trusting a third-party app in the Admin console: https://support.google.com/a/answer/7281227
