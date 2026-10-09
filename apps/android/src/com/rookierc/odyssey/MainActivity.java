package com.rookierc.odyssey;

import android.app.Activity;
import android.content.ActivityNotFoundException;
import android.content.ClipData;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Intent;
import android.graphics.Color;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import android.util.Log;
import android.view.Gravity;
import android.view.View;
import android.view.ViewGroup;
import android.webkit.JavascriptInterface;
import android.webkit.ValueCallback;
import android.webkit.WebChromeClient;
import android.webkit.WebResourceRequest;
import android.webkit.WebSettings;
import android.webkit.WebView;
import android.webkit.WebViewClient;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * The Atlas in a WebView, served by {@link LocalRuntime} on this phone.
 *
 * Besides showing the page it provides what a WebView lacks: a file picker
 * for photo uploads and .atlas imports, saving downloads (exports, posters,
 * tickets) to Downloads/Odyssey, the system share sheet, and the back button
 * (the page's window.odysseyBack closes its topmost layer first).
 */
public class MainActivity extends Activity {
    private static final String TAG = "Odyssey";
    private static final int PICK_FILES = 1;

    private final ExecutorService background = Executors.newSingleThreadExecutor();
    private WebView web;
    private View splash;
    private TextView splashText;
    private Button retry;
    private ValueCallback<Uri[]> pendingPick;
    private volatile int port = -1;
    /** Origin of the page now showing; the bridge only serves our own page. */
    private volatile String pageOrigin = "";

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        FrameLayout root = new FrameLayout(this);
        web = new WebView(this);
        root.addView(web, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        root.addView(buildSplash(), new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT));
        setContentView(root);
        configureWebView();
        start();
    }

    private View buildSplash() {
        LinearLayout box = new LinearLayout(this);
        box.setOrientation(LinearLayout.VERTICAL);
        box.setGravity(Gravity.CENTER);
        box.setBackgroundColor(getColor(R.color.paper));
        TextView title = new TextView(this);
        title.setText(R.string.app_name);
        title.setTextSize(30);
        title.setTextColor(getColor(R.color.ink));
        title.setTypeface(android.graphics.Typeface.SERIF);
        splashText = new TextView(this);
        splashText.setText(R.string.starting);
        splashText.setTextColor(getColor(R.color.ink_soft));
        splashText.setTextSize(14);
        splashText.setGravity(Gravity.CENTER);
        splashText.setPadding(48, 24, 48, 24);
        retry = new Button(this);
        retry.setText(R.string.retry);
        retry.setVisibility(View.GONE);
        retry.setOnClickListener(v -> {
            retry.setVisibility(View.GONE);
            splashText.setText(R.string.starting);
            start();
        });
        box.addView(title);
        box.addView(splashText);
        box.addView(retry);
        splash = box;
        return box;
    }

    private void configureWebView() {
        WebSettings s = web.getSettings();
        s.setJavaScriptEnabled(true);
        s.setDomStorageEnabled(true);
        s.setAllowFileAccess(false);
        s.setMediaPlaybackRequiresUserGesture(true);
        s.setUserAgentString(s.getUserAgentString() + " OdysseyAndroid");
        web.setBackgroundColor(Color.TRANSPARENT);
        web.addJavascriptInterface(new Bridge(), "OdysseyAndroid");

        web.setWebViewClient(new WebViewClient() {
            @Override
            public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) {
                Uri u = req.getUrl();
                if ("127.0.0.1".equals(u.getHost())) return false;
                // Links out of the Atlas (inspirations, personal sites) open in the browser.
                try {
                    startActivity(new Intent(Intent.ACTION_VIEW, u));
                } catch (ActivityNotFoundException e) {
                    Log.w(TAG, "no app for " + u);
                }
                return true;
            }

            @Override
            public void onPageStarted(WebView view, String url, android.graphics.Bitmap favicon) {
                pageOrigin = originOf(url);
            }

            @Override
            public void onPageFinished(WebView view, String url) {
                pageOrigin = originOf(url);
                if (url.startsWith(base())) splash.setVisibility(View.GONE);
            }

            @Override
            public boolean onRenderProcessGone(WebView view, android.webkit.RenderProcessGoneDetail detail) {
                // The page's renderer crashed or was reclaimed: start over.
                recreate();
                return true;
            }
        });

        web.setWebChromeClient(new WebChromeClient() {
            @Override
            public boolean onShowFileChooser(WebView view, ValueCallback<Uri[]> callback, FileChooserParams params) {
                if (pendingPick != null) pendingPick.onReceiveValue(null);
                pendingPick = callback;
                boolean images = false;
                for (String t : params.getAcceptTypes()) {
                    if (t != null && (t.startsWith("image/") || t.matches("\\.(jpe?g|png|gif|webp|heic)"))) images = true;
                }
                Intent pick = new Intent(Intent.ACTION_GET_CONTENT);
                pick.addCategory(Intent.CATEGORY_OPENABLE);
                pick.setType(images ? "image/*" : "*/*");
                if (params.getMode() == FileChooserParams.MODE_OPEN_MULTIPLE) {
                    pick.putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true);
                }
                try {
                    startActivityForResult(pick, PICK_FILES);
                } catch (ActivityNotFoundException e) {
                    pendingPick.onReceiveValue(null);
                    pendingPick = null;
                    return false;
                }
                return true;
            }
        });
    }

    private String base() {
        return "http://127.0.0.1:" + port;
    }

    private static String originOf(String url) {
        Uri u = Uri.parse(url);
        return u.getScheme() + "://" + u.getHost() + ":" + u.getPort();
    }

    /** Starts (or finds) the runtime off the UI thread, then loads the page. */
    private void start() {
        background.execute(() -> {
            try {
                int p = LocalRuntime.ensureRunning(getApplicationContext());
                runOnUiThread(() -> {
                    if (p != port || web.getUrl() == null) {
                        port = p;
                        web.loadUrl(base() + "/");
                    }
                });
            } catch (Exception e) {
                Log.e(TAG, "runtime failed", e);
                runOnUiThread(() -> {
                    splash.setVisibility(View.VISIBLE);
                    splashText.setText(getString(R.string.start_failed) + "\n\n" + e.getMessage());
                    retry.setVisibility(View.VISIBLE);
                });
            }
        });
    }

    @Override
    protected void onResume() {
        super.onResume();
        web.onResume();
        // The system may have stopped the runtime while the app was away.
        if (port > 0) start();
    }

    @Override
    protected void onPause() {
        web.onPause();
        super.onPause();
    }

    @Override
    protected void onDestroy() {
        if (isFinishing()) LocalRuntime.stop();
        web.destroy();
        background.shutdown();
        super.onDestroy();
    }

    @Override
    public void onBackPressed() {
        web.evaluateJavascript("window.odysseyBack ? window.odysseyBack() : false", handled -> {
            if (!"true".equals(handled)) moveTaskToBack(true);
        });
    }

    @Override
    protected void onActivityResult(int request, int result, Intent data) {
        if (request != PICK_FILES || pendingPick == null) {
            super.onActivityResult(request, result, data);
            return;
        }
        Uri[] picked = null;
        if (result == RESULT_OK && data != null) {
            ClipData clip = data.getClipData();
            if (clip != null && clip.getItemCount() > 0) {
                picked = new Uri[clip.getItemCount()];
                for (int i = 0; i < picked.length; i++) picked[i] = clip.getItemAt(i).getUri();
            } else if (data.getData() != null) {
                picked = new Uri[] {data.getData()};
            }
        }
        pendingPick.onReceiveValue(picked);
        pendingPick = null;
    }

    /** window.OdysseyAndroid — see apps/web/src/lib/native.ts. */
    private final class Bridge {
        private boolean fromOurPage() {
            return port > 0 && pageOrigin.equals(originOf(base()));
        }

        @JavascriptInterface
        public String saveFile(String base64, String fileName, String mime) {
            if (!fromOurPage()) return "";
            String name = safeName(fileName);
            try {
                byte[] bytes = Base64.decode(base64, Base64.DEFAULT);
                String where;
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, mime);
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS + "/Odyssey");
                    ContentResolver cr = getContentResolver();
                    Uri uri = cr.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, v);
                    if (uri == null) throw new IOException("MediaStore refused the file");
                    try (OutputStream out = cr.openOutputStream(uri)) {
                        if (out == null) throw new IOException("cannot open " + uri);
                        out.write(bytes);
                    }
                    where = Environment.DIRECTORY_DOWNLOADS + "/Odyssey/" + name;
                } else {
                    File dir = new File(getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), "Odyssey");
                    if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
                    File f = new File(dir, name);
                    try (FileOutputStream out = new FileOutputStream(f)) {
                        out.write(bytes);
                    }
                    where = f.getAbsolutePath();
                }
                toast(getString(R.string.saved_to, where));
                return where;
            } catch (IOException | IllegalArgumentException e) {
                Log.e(TAG, "save failed", e);
                toast(getString(R.string.save_failed));
                return "";
            }
        }

        @JavascriptInterface
        public void shareFile(String base64, String fileName, String mime, String title) {
            if (!fromOurPage()) return;
            try {
                File dir = ShareProvider.dir(MainActivity.this);
                if (!dir.isDirectory() && !dir.mkdirs()) throw new IOException("cannot create " + dir);
                File f = new File(dir, safeName(fileName));
                try (FileOutputStream out = new FileOutputStream(f)) {
                    out.write(Base64.decode(base64, Base64.DEFAULT));
                }
                Intent send = new Intent(Intent.ACTION_SEND);
                send.setType(mime);
                send.putExtra(Intent.EXTRA_STREAM, ShareProvider.uriFor(f.getName()));
                send.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                Intent chooser = Intent.createChooser(send, title);
                runOnUiThread(() -> startActivity(chooser));
            } catch (IOException | IllegalArgumentException | ActivityNotFoundException e) {
                Log.e(TAG, "share failed", e);
                toast(getString(R.string.share_failed));
            }
        }
    }

    private void toast(String msg) {
        runOnUiThread(() -> Toast.makeText(this, msg, Toast.LENGTH_LONG).show());
    }

    /** A plain file name: no directories, no control or reserved characters. */
    static String safeName(String name) {
        String n = name == null ? "" : name.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", "_").trim();
        while (n.startsWith(".")) n = n.substring(1);
        return n.isEmpty() ? "odyssey-file" : n;
    }
}
