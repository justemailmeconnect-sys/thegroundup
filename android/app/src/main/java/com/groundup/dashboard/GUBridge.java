package com.groundup.dashboard;

import android.Manifest;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.app.PendingIntent;
import android.content.ContentValues;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.database.Cursor;
import android.graphics.Color;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.webkit.JavascriptInterface;
import android.webkit.MimeTypeMap;
import android.widget.Toast;

import androidx.annotation.RequiresApi;
import androidx.core.content.FileProvider;

import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.security.SecureRandom;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicBoolean;

/**
 * window.GUAndroid: what a WebView cannot do by itself. The page (through assets/www/android-shim.js) hands
 * over files the app has made (blob downloads) to be saved into Downloads, shared through the share sheet,
 * or opened in another app. Large files arrive in pieces (beginFile / appendFile / endFile) so no single
 * huge string has to cross into Java.
 *
 * Every method returns a short string ("ok:..." / "error:...") or boolean and never throws into the page.
 */
public final class GUBridge {

    private static final String TAG = "GUAndroid";
    private static final long MAX_AGE_MS = 24L * 60 * 60 * 1000;     // staged files older than this are removed
    private static final long MAX_FILE_BYTES = 1024L * 1024 * 1024;  // sanity cap for one file
    private static final int MAX_TEXT_CHARS = 200_000;               // share-sheet text must fit in a binder transaction

    private static final class Staged {
        final File file;
        final String name;
        final String mime;

        Staged(File file, String name, String mime) {
            this.file = file;
            this.name = name;
            this.mime = mime;
        }
    }

    private static final class Transfer {
        final Staged staged;
        final OutputStream out;
        long written;

        Transfer(Staged staged, OutputStream out) {
            this.staged = staged;
            this.out = out;
        }
    }

    private final MainActivity activity;
    private final File stagingRoot;
    private final Handler main = new Handler(Looper.getMainLooper());
    private final SecureRandom random = new SecureRandom();
    private final Map<String, Transfer> transfers = new ConcurrentHashMap<>();
    private final Map<String, Staged> kept = new ConcurrentHashMap<>();
    private Staged pendingSave;     // waiting for the storage permission (Android 9 and older only)

    // The share sheet gives no "done" signal of its own. We learn which target was picked through the chooser's
    // IntentSender (ShareResultReceiver), and treat the sheet coming back to the front without that as a cancel.
    private static volatile GUBridge current;
    private final AtomicBoolean sharePending = new AtomicBoolean(false);
    private volatile boolean shareSawPause;

    GUBridge(MainActivity activity) {
        this.activity = activity;
        this.stagingRoot = new File(activity.getCacheDir(), "staged");
        current = this;
        new Thread(this::removeOldStaged, "gu-clean").start();
    }

    void release() {
        if (current == this) current = null;
    }

    /** Called by ShareResultReceiver when the user picked a target in the share sheet. */
    static void notifyShareChosen() {
        GUBridge b = current;
        if (b != null) b.finishShare(true);
    }

    void onActivityPaused() {
        if (sharePending.get()) shareSawPause = true;
    }

    void onActivityResumed() {
        if (sharePending.get() && shareSawPause) {
            main.postDelayed(() -> {
                if (sharePending.get()) finishShare(false);   // back from the sheet and nothing was picked
            }, 900);
        }
    }

    private void finishShare(boolean chosen) {
        if (!sharePending.getAndSet(false)) return;
        activity.runJs("window.__guShareDone&&window.__guShareDone(" + chosen + ")");
    }

    // ================================================================ the page-facing API

    /** Writes the file into the phone's Downloads folder and shows "Saved to Downloads: name". */
    @JavascriptInterface
    public String saveFile(String filename, String mimeType, String base64) {
        try {
            return saveStaged(stageBase64(filename, mimeType, base64));
        } catch (Throwable t) {
            return failed(filename, true, t);
        }
    }

    /** Opens the share sheet with some text. */
    @JavascriptInterface
    public String shareText(String text) {
        try {
            String t = text == null ? "" : text;
            if (t.length() > MAX_TEXT_CHARS) t = t.substring(0, MAX_TEXT_CHARS);
            Intent send = new Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, t);
            startChooser(send);
            return "ok";
        } catch (Throwable t) {
            return failed(null, false, t);
        }
    }

    /** Opens the share sheet with one file. */
    @JavascriptInterface
    public String shareFile(String filename, String mimeType, String base64) {
        try {
            List<Staged> one = new ArrayList<>();
            one.add(stageBase64(filename, mimeType, base64));
            shareStaged(one, "", "");
            return "ok";
        } catch (Throwable t) {
            return failed(filename, false, t);
        }
    }

    /** Opens the file in whichever app the phone offers for its type. */
    @JavascriptInterface
    public String openFile(String filename, String mimeType, String base64) {
        try {
            openStaged(stageBase64(filename, mimeType, base64));
            return "ok";
        } catch (Throwable t) {
            return failed(filename, false, t);
        }
    }

    /** Starts a file that arrives in pieces. Returns a token for appendFile / endFile / abortFile ("" on failure). */
    @JavascriptInterface
    public String beginFile(String filename, String mimeType) {
        try {
            Staged s = newStaged(filename, mimeType);
            String token = randomId();
            transfers.put(token, new Transfer(s, new FileOutputStream(s.file)));
            return token;
        } catch (Throwable t) {
            failed(filename, true, t);
            return "";
        }
    }

    /** Adds one piece (base64 of a whole number of 3-byte groups, except possibly the last piece). */
    @JavascriptInterface
    public boolean appendFile(String token, String base64Piece) {
        Transfer tr = token == null ? null : transfers.get(token);
        if (tr == null) return false;
        try {
            byte[] bytes = Base64.decode(base64Piece == null ? "" : base64Piece, Base64.DEFAULT);
            tr.written += bytes.length;
            if (tr.written > MAX_FILE_BYTES) throw new IOException("file too large");
            tr.out.write(bytes);
            return true;
        } catch (Throwable t) {
            abortFile(token);
            failed(tr.staged.name, true, t);
            return false;
        }
    }

    /**
     * Finishes a piecewise file and acts on it: "save" (to Downloads), "share" (share sheet, options JSON may
     * carry title and text), "open" (another app), or "keep" (hold it for shareKept). Returns "ok:..." or "error:...".
     */
    @JavascriptInterface
    public String endFile(String token, String action, String optionsJson) {
        Transfer tr = token == null ? null : transfers.remove(token);
        if (tr == null) return "error: unknown transfer";
        try {
            tr.out.close();
            String a = action == null ? "" : action;
            switch (a) {
                case "save":
                    return saveStaged(tr.staged);
                case "open":
                    openStaged(tr.staged);
                    return "ok";
                case "share": {
                    List<Staged> one = new ArrayList<>();
                    one.add(tr.staged);
                    JSONObject o = options(optionsJson);
                    shareStaged(one, o.optString("title", ""), o.optString("text", ""));
                    return "ok";
                }
                case "keep":
                    kept.put(token, tr.staged);
                    return "ok:" + token;
                default:
                    deleteStaged(tr.staged);
                    return "error: unknown action";
            }
        } catch (Throwable t) {
            deleteStaged(tr.staged);
            return failed(tr.staged.name, "save".equals(action), t);
        }
    }

    /** Shares several files held with endFile(token, "keep"). tokensCsv is "t1,t2,...". */
    @JavascriptInterface
    public String shareKept(String tokensCsv, String optionsJson) {
        List<Staged> files = new ArrayList<>();
        try {
            for (String tok : (tokensCsv == null ? "" : tokensCsv).split(",")) {
                Staged s = kept.remove(tok.trim());
                if (s != null) files.add(s);
            }
            if (files.isEmpty()) return "error: nothing to share";
            JSONObject o = options(optionsJson);
            shareStaged(files, o.optString("title", ""), o.optString("text", ""));
            return "ok";
        } catch (Throwable t) {
            for (Staged s : files) deleteStaged(s);
            return failed(null, false, t);
        }
    }

    @JavascriptInterface
    public void abortFile(String token) {
        Transfer tr = token == null ? null : transfers.remove(token);
        if (tr == null) return;
        try {
            tr.out.close();
        } catch (IOException ignored) {
            // already failing
        }
        deleteStaged(tr.staged);
    }

    /** True: the page will be told (window.__guShareDone) whether the share sheet was used or dismissed. */
    @JavascriptInterface
    public boolean shareTracked() {
        return true;
    }

    /** A short message for the user (the shim uses it when a download cannot be read). */
    @JavascriptInterface
    public void toast(String message) {
        if (message == null || message.trim().isEmpty()) return;
        showToast(message.length() > 200 ? message.substring(0, 200) : message);
    }

    /** The page reports its status-bar and bottom-bar colours (#rrggbb) so the phone's bars match the app. */
    @JavascriptInterface
    public void setBars(String statusHex, String navHex) {
        try {
            final int status = Color.parseColor(statusHex);
            final int nav = Color.parseColor(navHex);
            main.post(() -> activity.applyBars(status, nav));
        } catch (RuntimeException e) {
            Log.w(TAG, "setBars ignored: " + e.getMessage());
        }
    }

    // ================================================================ staging (every file passes through the cache first)

    private Staged newStaged(String filename, String mimeType) throws IOException {
        String name = FileNames.sanitise(filename, "download");
        File dir = new File(stagingRoot, randomId());
        if (!dir.mkdirs() && !dir.isDirectory()) throw new IOException("cannot create a staging folder");
        return new Staged(new File(dir, name), name, resolveMime(name, mimeType));
    }

    private Staged stageBase64(String filename, String mimeType, String base64) throws IOException {
        Staged s = newStaged(filename, mimeType);
        try (OutputStream out = new FileOutputStream(s.file)) {
            out.write(Base64.decode(base64 == null ? "" : base64, Base64.DEFAULT));
        } catch (IOException | RuntimeException e) {
            deleteStaged(s);
            throw e;
        }
        return s;
    }

    /** The file's type: from its extension when the phone knows it (MediaStore wants name and type to agree), else the page's. */
    private static String resolveMime(String name, String given) {
        String ext = FileNames.extension(name).toLowerCase(Locale.ROOT);
        String fromExt = ext.isEmpty() ? null : MimeTypeMap.getSingleton().getMimeTypeFromExtension(ext);
        if (fromExt != null) return fromExt;
        String g = FileNames.cleanMime(given);
        return g.isEmpty() ? "application/octet-stream" : g;
    }

    private void deleteStaged(Staged s) {
        if (s == null) return;
        File dir = s.file.getParentFile();
        //noinspection ResultOfMethodCallIgnored
        s.file.delete();
        if (dir != null && !dir.equals(stagingRoot)) {
            //noinspection ResultOfMethodCallIgnored
            dir.delete();
        }
    }

    private void removeOldStaged() {
        File[] dirs = stagingRoot.listFiles();
        if (dirs == null) return;
        long cutoff = System.currentTimeMillis() - MAX_AGE_MS;
        for (File d : dirs) {
            if (d.lastModified() > cutoff) continue;
            File[] files = d.listFiles();
            if (files != null) {
                for (File f : files) {
                    //noinspection ResultOfMethodCallIgnored
                    f.delete();
                }
            }
            //noinspection ResultOfMethodCallIgnored
            d.delete();
        }
    }

    private String randomId() {
        byte[] b = new byte[12];
        random.nextBytes(b);
        StringBuilder sb = new StringBuilder();
        for (byte x : b) sb.append(String.format("%02x", x));
        return sb.toString();
    }

    private static JSONObject options(String json) {
        try {
            return json == null || json.isEmpty() ? new JSONObject() : new JSONObject(json);
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    // ================================================================ save to Downloads

    private String saveStaged(Staged s) throws IOException {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q
                && activity.checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) != PackageManager.PERMISSION_GRANTED) {
            Staged replaced;
            synchronized (this) {
                replaced = pendingSave;
                pendingSave = s;
            }
            deleteStaged(replaced);
            main.post(activity::requestStoragePermission);
            return "pending";
        }
        try {
            String shown = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q ? saveWithMediaStore(s) : saveLegacy(s);
            showToast(activity.getString(R.string.saved_to_downloads, shown));
            return "ok:" + shown;
        } finally {
            deleteStaged(s);
        }
    }

    /** Android 10 and newer: no permission needed; the file goes into the shared Downloads collection. */
    @RequiresApi(Build.VERSION_CODES.Q)
    private String saveWithMediaStore(Staged s) throws IOException {
        ContentResolver resolver = activity.getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.MediaColumns.DISPLAY_NAME, s.name);
        v.put(MediaStore.MediaColumns.MIME_TYPE, s.mime);
        v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS);
        v.put(MediaStore.MediaColumns.IS_PENDING, 1);
        Uri uri = resolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
        if (uri == null) throw new IOException("Downloads is not available");
        try (InputStream in = new FileInputStream(s.file);
             OutputStream out = resolver.openOutputStream(uri)) {
            if (out == null) throw new IOException("cannot write to Downloads");
            copy(in, out);
        } catch (IOException | RuntimeException e) {
            resolver.delete(uri, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
        resolver.update(uri, done, null, null);
        String shown = s.name;
        try (Cursor c = resolver.query(uri, new String[]{MediaStore.MediaColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && c.getString(0) != null) shown = c.getString(0);
        } catch (RuntimeException ignored) {
            // keep the name we asked for
        }
        return shown;
    }

    /** Android 9 and older: a plain file in the public Downloads folder (needs WRITE_EXTERNAL_STORAGE). */
    @SuppressWarnings("deprecation")
    private String saveLegacy(Staged s) throws IOException {
        File dir = Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_DOWNLOADS);
        if (!dir.mkdirs() && !dir.isDirectory()) throw new IOException("Downloads is not available");
        File dest = FileNames.unique(dir, s.name);
        try (InputStream in = new FileInputStream(s.file); OutputStream out = new FileOutputStream(dest)) {
            copy(in, out);
        }
        MediaScannerConnection.scanFile(activity, new String[]{dest.getAbsolutePath()}, new String[]{s.mime}, null);
        return dest.getName();
    }

    /** The answer to the storage-permission prompt (Android 9 and older). Runs on the UI thread. */
    void onStoragePermissionResult(boolean granted) {
        final Staged s;
        synchronized (this) {
            s = pendingSave;
            pendingSave = null;
        }
        if (s == null) return;
        if (!granted) {
            deleteStaged(s);
            showToast(activity.getString(R.string.storage_denied));
            return;
        }
        new Thread(() -> {
            try {
                String shown = saveLegacy(s);
                deleteStaged(s);
                showToast(activity.getString(R.string.saved_to_downloads, shown));
            } catch (Throwable t) {
                deleteStaged(s);
                failed(s.name, true, t);
            }
        }, "gu-save").start();
    }

    private static void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[64 * 1024];
        int n;
        while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
        out.flush();
    }

    // ================================================================ share and open

    private void shareStaged(List<Staged> files, String title, String text) {
        final ArrayList<Uri> uris = new ArrayList<>();
        for (Staged s : files) {
            uris.add(FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", s.file));
        }
        final Intent send;
        if (files.size() == 1) {
            send = new Intent(Intent.ACTION_SEND).setType(files.get(0).mime).putExtra(Intent.EXTRA_STREAM, uris.get(0));
        } else {
            send = new Intent(Intent.ACTION_SEND_MULTIPLE).setType(commonMime(files)).putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris);
        }
        if (text != null && !text.isEmpty()) send.putExtra(Intent.EXTRA_TEXT, text.length() > MAX_TEXT_CHARS ? text.substring(0, MAX_TEXT_CHARS) : text);
        if (title != null && !title.isEmpty()) send.putExtra(Intent.EXTRA_SUBJECT, title);
        send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        ClipData clip = ClipData.newRawUri(null, uris.get(0));
        for (int i = 1; i < uris.size(); i++) clip.addItem(new ClipData.Item(uris.get(i)));
        send.setClipData(clip);
        startChooser(send);
    }

    private static String commonMime(List<Staged> files) {
        String first = files.get(0).mime;
        String top = first.contains("/") ? first.substring(0, first.indexOf('/')) : "*";
        boolean sameType = true;
        boolean sameTop = true;
        for (Staged s : files) {
            if (!s.mime.equals(first)) sameType = false;
            if (!s.mime.startsWith(top + "/")) sameTop = false;
        }
        return sameType ? first : sameTop ? top + "/*" : "*/*";
    }

    private void openStaged(Staged s) {
        final Uri uri = FileProvider.getUriForFile(activity, activity.getPackageName() + ".files", s.file);
        final Intent view = new Intent(Intent.ACTION_VIEW).setDataAndType(uri, s.mime)
                .addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
        view.setClipData(ClipData.newRawUri(null, uri));
        main.post(() -> {
            try {
                activity.startActivity(view);
            } catch (ActivityNotFoundException e) {
                Toast.makeText(activity, R.string.no_app_to_open, Toast.LENGTH_LONG).show();
            } catch (RuntimeException e) {
                Log.w(TAG, "open failed", e);
                Toast.makeText(activity, R.string.no_app_to_open, Toast.LENGTH_LONG).show();
            }
        });
    }

    private void startChooser(Intent send) {
        // Immutable and explicit: the system only tells our own receiver which target was picked.
        PendingIntent picked = PendingIntent.getBroadcast(activity, 0,
                new Intent(activity, ShareResultReceiver.class), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        final Intent chooser = Intent.createChooser(send, activity.getString(R.string.share_title), picked.getIntentSender());
        shareSawPause = false;
        sharePending.set(true);
        main.post(() -> {
            try {
                activity.startActivity(chooser);
            } catch (RuntimeException e) {
                Log.w(TAG, "share failed", e);
                Toast.makeText(activity, R.string.share_failed, Toast.LENGTH_LONG).show();
                finishShare(false);
            }
        });
    }

    // ================================================================ feedback

    private void showToast(final String message) {
        main.post(() -> Toast.makeText(activity, message, Toast.LENGTH_LONG).show());
    }

    private String failed(String filename, boolean saving, Throwable t) {
        Log.w(TAG, "request failed", t);
        String name = filename == null || filename.isEmpty() ? "" : FileNames.sanitise(filename, "file");
        showToast(saving && !name.isEmpty() ? activity.getString(R.string.save_failed, name) : activity.getString(R.string.share_failed));
        return "error: " + (t.getMessage() == null ? t.getClass().getSimpleName() : t.getMessage());
    }
}
