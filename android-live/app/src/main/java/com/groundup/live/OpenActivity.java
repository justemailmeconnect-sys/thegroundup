package com.groundup.live;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.widget.Toast;

import androidx.browser.customtabs.CustomTabColorSchemeParams;
import androidx.browser.customtabs.CustomTabsClient;
import androidx.browser.customtabs.CustomTabsIntent;

import java.util.Arrays;
import java.util.List;

/**
 * The whole app: open the online dashboard (R.string.live_url) in a Chrome Custom Tab and finish, so Back from the
 * browser goes to the home screen. No UI of its own (Theme.NoDisplay).
 *
 * Order tried: Custom Tab in a browser that supports it, then a plain ACTION_VIEW, then a Toast.
 */
public class OpenActivity extends Activity {

    /** Looked at after the phone's default browser, in this order, if the default one has no Custom Tabs support. */
    private static final List<String> PREFERRED_BROWSERS = Arrays.asList(
            "com.android.chrome",
            "com.chrome.beta",
            "com.chrome.dev",
            "com.chrome.canary",
            "com.google.android.apps.chrome",
            "com.sec.android.app.sbrowser",
            "com.microsoft.emmx",
            "com.brave.browser",
            "org.mozilla.firefox");

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Uri url = Uri.parse(getString(R.string.live_url));
        if (!openInCustomTab(url) && !openInBrowser(url)) {
            Toast.makeText(getApplicationContext(), R.string.cannot_open, Toast.LENGTH_LONG).show();
        }
        finish();
    }

    /** True if a Custom Tab was started. False if no installed browser supports Custom Tabs or it could not be started. */
    private boolean openInCustomTab(Uri url) {
        try {
            String browser = CustomTabsClient.getPackageName(this, PREFERRED_BROWSERS);
            if (browser == null) return false;

            CustomTabsIntent tab = new CustomTabsIntent.Builder()
                    .setDefaultColorSchemeParams(new CustomTabColorSchemeParams.Builder()
                            .setToolbarColor(getColor(R.color.toolbar_light))
                            .build())
                    .setColorSchemeParams(CustomTabsIntent.COLOR_SCHEME_DARK, new CustomTabColorSchemeParams.Builder()
                            .setToolbarColor(getColor(R.color.toolbar_dark))
                            .build())
                    .setUrlBarHidingEnabled(true)
                    .setShareState(CustomTabsIntent.SHARE_STATE_DEFAULT)
                    .build();
            tab.intent.setPackage(browser);
            tab.launchUrl(this, url);
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }

    /** Plain "open this link": whatever browser (or app) handles https links. */
    private boolean openInBrowser(Uri url) {
        try {
            startActivity(new Intent(Intent.ACTION_VIEW, url).addCategory(Intent.CATEGORY_BROWSABLE));
            return true;
        } catch (ActivityNotFoundException | SecurityException e) {
            return false;
        }
    }
}
