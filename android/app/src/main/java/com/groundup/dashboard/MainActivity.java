package com.groundup.dashboard;

import android.Manifest;
import android.annotation.SuppressLint;
import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.res.Configuration;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.view.View;
import android.view.Window;
import android.view.WindowInsetsController;
import android.webkit.CookieManager;
import android.webkit.GeolocationPermissions;
import android.webkit.MimeTypeMap;
import android.webkit.PermissionRequest;
import android.webkit.RenderProcessGoneDetail;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebResourceResponse;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Toast;

import androidx.webkit.WebViewAssetLoader;

import java.io.ByteArrayInputStream;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.Locale;
import java.util.Set;

/**
 * The whole app: one full-screen WebView showing the bundled web app (assets/www) from a secure
 * https origin (https://appassets.androidplatform.net) so localStorage, IndexedDB, crypto.subtle and the
 * clipboard behave as they do in a browser. Everything that is not that origin opens in the phone's browser.
 */
public class MainActivity extends Activity {

    static final String HOST = "appassets.androidplatform.net";
    static final String START_URL = "https://" + HOST + "/assets/www/index.html";

    private static final int REQ_FILE_CHOOSER = 1001;
    static final int REQ_STORAGE = 1002;

    /**
     * Run by the Back button: closes the top dialog, menu or chat panel if one is open (the same as Escape does).
     * Returns 1 when something was closed, 2 when the app is locked (Back just leaves the app), 0 otherwise.
     * The function itself lives in the shim (assets/www/android-shim.js).
     */
    private static final String BACK_SCRIPT = "(function(){try{return window.__guBack?window.__guBack():0;}catch(e){return 0;}})()";

    private WebView webView;
    private WebViewAssetLoader assetLoader;
    private GUBridge bridge;
    private ValueCallback<Uri[]> filePathCallback;

    @SuppressLint("SetJavaScriptEnabled")   // the app is JavaScript; it only ever loads its own bundled pages
    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        WebView.setWebContentsDebuggingEnabled(false);

        assetLoader = new WebViewAssetLoader.Builder()
                .setDomain(HOST)
                .addPathHandler("/assets/", new AssetHandler(this))
                .build();

        webView = new WebView(this);
        webView.setBackgroundColor(getColor(R.color.paper));
        setContentView(webView);

        WebSettings s = webView.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);          // localStorage + IndexedDB, kept in this app's own storage
        s.setAllowFileAccess(false);
        s.setAllowContentAccess(false);
        s.setAllowFileAccessFromFileURLs(false);
        s.setAllowUniversalAccessFromFileURLs(false);
        s.setMixedContentMode(WebSettings.MIXED_CONTENT_NEVER_ALLOW);
        s.setGeolocationEnabled(false);
        s.setSupportMultipleWindows(false);
        s.setJavaScriptCanOpenWindowsAutomatically(false);
        s.setMediaPlaybackRequiresUserGesture(true);

        bridge = new GUBridge(this);
        webView.addJavascriptInterface(bridge, "GUAndroid");
        webView.setWebViewClient(new AppClient());
        webView.setWebChromeClient(new AppChrome());

        if (savedInstanceState == null || webView.restoreState(savedInstanceState) == null) {
            webView.loadUrl(START_URL);
        }
    }

    // ---------------------------------------------------------------- bundled files

    /**
     * Serves assets/www with the right content types. WebViewAssetLoader's own table does not know web fonts
     * (it would label a .woff2 "text/plain"), so those and a few others are set here; text is always UTF-8.
     */
    private static final class AssetHandler implements WebViewAssetLoader.PathHandler {
        private final WebViewAssetLoader.AssetsPathHandler inner;

        AssetHandler(Context context) {
            inner = new WebViewAssetLoader.AssetsPathHandler(context);
        }

        @Override
        public WebResourceResponse handle(String path) {
            WebResourceResponse response = inner.handle(path);
            if (response == null) return null;
            String mime = mimeOverride(path);
            if (mime != null) response.setMimeType(mime);
            String type = response.getMimeType();
            if (type != null && (type.startsWith("text/") || type.contains("javascript") || type.contains("json")
                    || type.contains("xml"))) {
                response.setEncoding("UTF-8");
            }
            return response;
        }

        private static String mimeOverride(String path) {
            int dot = path.lastIndexOf('.');
            String ext = dot < 0 ? "" : path.substring(dot + 1).toLowerCase(Locale.ROOT);
            switch (ext) {
                case "woff2": return "font/woff2";
                case "woff": return "font/woff";
                case "ttf": return "font/ttf";
                case "otf": return "font/otf";
                case "json": return "application/json";
                case "webmanifest": return "application/manifest+json";
                case "js":
                case "mjs": return "text/javascript";
                case "css": return "text/css";
                case "html":
                case "htm": return "text/html";
                case "svg": return "image/svg+xml";
                case "ico": return "image/x-icon";
                case "txt": return "text/plain";
                default: return null;
            }
        }
    }

    // ---------------------------------------------------------------- WebView clients

    private final class AppClient extends WebViewClient {
        @Override
        public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest request) {
            Uri uri = request.getUrl();
            if (!isAppOrigin(uri)) return null;                       // CDNs, fonts, APIs: normal network
            WebResourceResponse res = assetLoader.shouldInterceptRequest(uri);
            if (res != null) return res;
            return new WebResourceResponse("text/plain", "UTF-8", 404, "Not Found",
                    new HashMap<String, String>(), new ByteArrayInputStream(new byte[0]));
        }

        @Override
        public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest request) {
            return handleNavigation(request.getUrl(), request.isForMainFrame());
        }

        @Override
        public boolean onRenderProcessGone(WebView view, RenderProcessGoneDetail detail) {
            // The page's renderer died (usually out of memory). Start over rather than crash the app.
            runOnUiThread(MainActivity.this::recreate);
            return true;
        }
    }

    private final class AppChrome extends WebChromeClient {
        @Override
        public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
            if (filePathCallback != null) filePathCallback.onReceiveValue(null);
            filePathCallback = callback;
            Intent intent;
            try {
                intent = params.createIntent();
            } catch (RuntimeException e) {
                intent = new Intent(Intent.ACTION_GET_CONTENT).addCategory(Intent.CATEGORY_OPENABLE);
            }
            applyAcceptTypes(intent, params.getAcceptTypes());
            // 1 = several files; 2 = a folder (not supported by Android's picker, so let people choose several files instead)
            if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE || params.getMode() == 2) {
                intent.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
            }
            try {
                startActivityForResult(intent, REQ_FILE_CHOOSER);
            } catch (ActivityNotFoundException | SecurityException e) {
                filePathCallback = null;
                callback.onReceiveValue(null);
                Toast.makeText(MainActivity.this, R.string.no_file_picker, Toast.LENGTH_LONG).show();
            }
            return true;
        }

        // The app never asks for camera, microphone or location; say no if a page ever does.
        @Override
        public void onPermissionRequest(PermissionRequest request) {
            request.deny();
        }

        @Override
        public void onGeolocationPermissionsShowPrompt(String origin, GeolocationPermissions.Callback callback) {
            callback.invoke(origin, false, false);
        }
    }

    // ---------------------------------------------------------------- navigation

    private static boolean isAppOrigin(Uri uri) {
        return uri != null && "https".equals(uri.getScheme()) && HOST.equalsIgnoreCase(uri.getHost());
    }

    /** true = this app handled it (do not load it in the WebView). */
    private boolean handleNavigation(Uri uri, boolean mainFrame) {
        if (!mainFrame) return false;               // frames inside the page (e.g. a blob: PDF viewer) load as normal
        if (isAppOrigin(uri)) return false;         // the app's own pages and #routes
        String scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        switch (scheme) {
            case "http":
            case "https":
            case "mailto":
            case "tel":
            case "sms":
            case "smsto":
            case "geo":
                openExternal(uri);
                return true;
            default:
                return true;                         // blob:, data:, file:, content:, intent:, javascript: ... stay out
        }
    }

    private void openExternal(Uri uri) {
        Intent intent = new Intent(Intent.ACTION_VIEW, uri).addCategory(Intent.CATEGORY_BROWSABLE);
        try {
            startActivity(intent);
        } catch (ActivityNotFoundException | SecurityException e) {
            Toast.makeText(this, R.string.no_app_to_open, Toast.LENGTH_LONG).show();
        }
    }

    // ---------------------------------------------------------------- file chooser

    /** Turns the input's accept list (mime types and .extensions) into the picker's filter. */
    private static void applyAcceptTypes(Intent intent, String[] accept) {
        Set<String> mimes = new LinkedHashSet<>();
        boolean any = accept == null || accept.length == 0;
        if (!any) {
            for (String entry : accept) {
                if (entry == null) continue;
                for (String part : entry.split(",")) {
                    String t = part.trim().toLowerCase(Locale.ROOT);
                    if (t.isEmpty()) continue;
                    if (t.indexOf('/') > 0) {
                        mimes.add(t);
                    } else if (t.startsWith(".")) {
                        String m = mimeForExtension(t.substring(1));
                        if (m != null) mimes.add(m);
                        else { any = true; break; }
                    }
                }
                if (any) break;
            }
        }
        if (any || mimes.isEmpty() || mimes.contains("*/*")) {
            intent.setType("*/*");
            intent.removeExtra(Intent.EXTRA_MIME_TYPES);
        } else if (mimes.size() == 1) {
            intent.setType(mimes.iterator().next());
            intent.removeExtra(Intent.EXTRA_MIME_TYPES);
        } else {
            mimes.add("application/octet-stream");   // files the phone cannot identify stay selectable
            intent.setType("*/*");
            intent.putExtra(Intent.EXTRA_MIME_TYPES, mimes.toArray(new String[0]));
        }
    }

    private static String mimeForExtension(String ext) {
        switch (ext) {
            case "pdf": return "application/pdf";
            case "heic": return "image/heic";
            case "heif": return "image/heif";
            case "doc": return "application/msword";
            case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
            case "xls": return "application/vnd.ms-excel";
            case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
            case "txt": return "text/plain";
            case "csv": return "text/csv";
            case "eml": return "message/rfc822";
            case "json": return "application/json";
            case "zip": return "application/zip";
            default: return MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        }
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        if (requestCode == REQ_FILE_CHOOSER) {
            ValueCallback<Uri[]> callback = filePathCallback;
            filePathCallback = null;
            if (callback == null) return;
            Uri[] result = null;
            if (resultCode == RESULT_OK) {
                result = WebChromeClient.FileChooserParams.parseResult(resultCode, data);
            }
            callback.onReceiveValue(result);       // null = cancelled
            return;
        }
        super.onActivityResult(requestCode, resultCode, data);
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        if (requestCode == REQ_STORAGE) {
            boolean granted = grantResults.length > 0 && grantResults[0] == PackageManager.PERMISSION_GRANTED;
            bridge.onStoragePermissionResult(granted);
            return;
        }
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
    }

    // ---------------------------------------------------------------- back button

    @SuppressWarnings("deprecation")
    @Override
    public void onBackPressed() {
        webView.evaluateJavascript(BACK_SCRIPT, value -> {
            String v = value == null ? "0" : value.trim();
            if ("1".equals(v)) return;                                  // closed a dialog / menu / chat panel
            if (!"2".equals(v) && webView.canGoBack()) {
                webView.goBack();                                       // the #hash routes are history entries
            } else {
                super.onBackPressed();                     // nowhere left to go: leave the app
            }
        });
    }

    // ---------------------------------------------------------------- system bars

    /** Called (via the shim) so the status and navigation bars follow the page's colours, light or dark. */
    void applyBars(int status, int nav) {
        Window w = getWindow();
        status |= 0xFF000000;
        nav |= 0xFF000000;
        boolean lightStatus = isLight(status);
        boolean lightNav = isLight(nav);
        if (lightNav && Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
            nav = getColor(R.color.bottom_bar);       // Android 7.x cannot draw dark icons on a light navigation bar
            lightNav = false;
        }
        w.setStatusBarColor(status);
        w.setNavigationBarColor(nav);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            WindowInsetsController c = w.getInsetsController();
            if (c != null) {
                c.setSystemBarsAppearance(lightStatus ? WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS : 0,
                        WindowInsetsController.APPEARANCE_LIGHT_STATUS_BARS);
                c.setSystemBarsAppearance(lightNav ? WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS : 0,
                        WindowInsetsController.APPEARANCE_LIGHT_NAVIGATION_BARS);
            }
        } else {
            View decor = w.getDecorView();
            int f = decor.getSystemUiVisibility();
            f = lightStatus ? (f | View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR);
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                f = lightNav ? (f | View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR) : (f & ~View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR);
            }
            decor.setSystemUiVisibility(f);
        }
    }

    private static boolean isLight(int color) {
        double y = 0.299 * Color.red(color) + 0.587 * Color.green(color) + 0.114 * Color.blue(color);
        return y > 150;
    }

    @Override
    public void onConfigurationChanged(Configuration newConfig) {
        super.onConfigurationChanged(newConfig);
        // Day/night flipped or the phone turned: ask the page to report its colours again.
        if (webView != null) webView.evaluateJavascript("window.__guBars&&window.__guBars()", null);
    }

    // ---------------------------------------------------------------- lifecycle

    @Override
    protected void onSaveInstanceState(Bundle outState) {
        super.onSaveInstanceState(outState);
        webView.saveState(outState);
    }

    @Override
    protected void onResume() {
        super.onResume();
        webView.onResume();
        bridge.onActivityResumed();
    }

    @Override
    protected void onPause() {
        bridge.onActivityPaused();
        webView.onPause();
        CookieManager.getInstance().flush();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (filePathCallback != null) {
            filePathCallback.onReceiveValue(null);
            filePathCallback = null;
        }
        if (bridge != null) bridge.release();
        if (webView != null) {
            webView.removeJavascriptInterface("GUAndroid");
            webView.stopLoading();
            webView.setWebViewClient(new WebViewClient());
            webView.setWebChromeClient(null);
            webView.destroy();
            webView = null;
        }
        super.onDestroy();
    }

    /** Runs a line of script in the page (from the UI thread or any other). */
    void runJs(final String script) {
        runOnUiThread(() -> {
            if (webView != null) webView.evaluateJavascript(script, null);
        });
    }

    /** Used by the bridge to ask for the legacy storage permission (Android 9 and older only). */
    void requestStoragePermission() {
        requestPermissions(new String[]{Manifest.permission.WRITE_EXTERNAL_STORAGE}, REQ_STORAGE);
    }
}
