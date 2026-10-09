package com.rookierc.odyssey;

import android.content.Context;
import android.net.ConnectivityManager;
import android.net.LinkProperties;
import android.net.Network;
import android.text.TextUtils;
import android.util.Log;

import java.io.BufferedReader;
import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.TimeZone;

/**
 * Runs the Odyssey Go runtime on the phone: the same single-user local mode
 * as the desktop program, listening on 127.0.0.1 only, with its data in the
 * app's private storage (files/atlas-data).
 *
 * The runtime is a static linux executable shipped as
 * lib/&lt;abi&gt;/libodyssey.so: Android only lets apps execute files from
 * their native library directory, and only extracts files named lib*.so
 * there.
 */
final class LocalRuntime {
    private static final String TAG = "OdysseyRuntime";
    private static final int PREFERRED_PORT = 4317;
    private static final long START_TIMEOUT_MS = 20_000;

    private static Process process;
    private static int port = -1;
    private static final ArrayDeque<String> lastLines = new ArrayDeque<>();

    private LocalRuntime() {}

    /** Starts the runtime unless it is already serving; returns its port. Blocking — never call on the UI thread. */
    static synchronized int ensureRunning(Context ctx) throws IOException, InterruptedException {
        File dataDir = new File(ctx.getFilesDir(), "atlas-data");
        if (process != null && alive(process) && serves(port, dataDir)) return port;
        // A runtime left over from an earlier app process (same data) is reused,
        // so two runtimes never write the same files.
        if (serves(PREFERRED_PORT, dataDir)) {
            port = PREFERRED_PORT;
            return port;
        }
        stop();

        port = freePort();
        File exe = new File(ctx.getApplicationInfo().nativeLibraryDir, "libodyssey.so");
        ProcessBuilder pb = new ProcessBuilder(
                exe.getAbsolutePath(),
                "-data", dataDir.getAbsolutePath(),
                "-host", "127.0.0.1",
                "-port", String.valueOf(port),
                "-open-browser=false");
        Map<String, String> env = pb.environment();
        env.put("HOME", ctx.getFilesDir().getAbsolutePath());
        env.put("XDG_CACHE_HOME", ctx.getCacheDir().getAbsolutePath());
        env.put("TMPDIR", ctx.getCacheDir().getAbsolutePath());
        env.put("TZ", TimeZone.getDefault().getID());
        // Android 14+ keeps the CA store in the Conscrypt APEX; older releases in /system.
        env.put("SSL_CERT_DIR", "/apex/com.android.conscrypt/cacerts:/system/etc/security/cacerts");
        env.put("ATLAS_DNS", dnsServers(ctx));
        pb.redirectErrorStream(true);
        Log.i(TAG, "starting " + exe + " on port " + port);
        process = pb.start();
        drain(process.getInputStream());

        long deadline = System.currentTimeMillis() + START_TIMEOUT_MS;
        while (System.currentTimeMillis() < deadline) {
            if (!alive(process)) throw new IOException("runtime exited: " + recentLog());
            if (serves(port, dataDir)) return port;
            Thread.sleep(150);
        }
        throw new IOException("runtime did not answer: " + recentLog());
    }

    static synchronized void stop() {
        if (process != null) {
            process.destroy();
            process = null;
        }
    }

    static synchronized String recentLog() {
        return TextUtils.join("\n", lastLines);
    }

    private static boolean alive(Process p) {
        try {
            p.exitValue();
            return false;
        } catch (IllegalThreadStateException running) {
            return true;
        }
    }

    /** Whether an Odyssey runtime for this data directory answers on port. */
    private static boolean serves(int p, File dataDir) {
        if (p <= 0) return false;
        HttpURLConnection c = null;
        try {
            c = (HttpURLConnection) new URL("http://127.0.0.1:" + p + "/api/runtime").openConnection();
            c.setConnectTimeout(400);
            c.setReadTimeout(800);
            if (c.getResponseCode() != 200) return false;
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line);
            }
            // Compact JSON from Go's encoder (which never escapes '/').
            return sb.toString().contains("\"dataDir\":\"" + dataDir.getAbsolutePath() + "\"");
        } catch (IOException e) {
            return false;
        } finally {
            if (c != null) c.disconnect();
        }
    }

    /** The preferred port (a stable origin keeps the page's own preferences), else any free one. */
    private static int freePort() throws IOException {
        InetAddress lo = InetAddress.getByName("127.0.0.1");
        try (ServerSocket s = new ServerSocket(PREFERRED_PORT, 1, lo)) {
            return s.getLocalPort();
        } catch (IOException taken) {
            try (ServerSocket s = new ServerSocket(0, 1, lo)) {
                return s.getLocalPort();
            }
        }
    }

    /**
     * The active network's DNS servers, then public fallbacks. Android has no
     * /etc/resolv.conf for the Go resolver to read (cmd/atlas configureDNS).
     */
    private static String dnsServers(Context ctx) {
        List<String> out = new ArrayList<>();
        try {
            ConnectivityManager cm = (ConnectivityManager) ctx.getSystemService(Context.CONNECTIVITY_SERVICE);
            Network n = cm.getActiveNetwork();
            LinkProperties lp = n != null ? cm.getLinkProperties(n) : null;
            if (lp != null) {
                for (InetAddress a : lp.getDnsServers()) {
                    String h = a.getHostAddress();
                    int pct = h.indexOf('%');
                    if (pct >= 0) h = h.substring(0, pct);
                    if (!h.isEmpty() && !out.contains(h)) out.add(h);
                }
            }
        } catch (RuntimeException e) {
            Log.w(TAG, "no DNS servers from the system", e);
        }
        for (String fallback : new String[] {"1.1.1.1", "8.8.8.8", "223.5.5.5"}) {
            if (!out.contains(fallback)) out.add(fallback);
        }
        return TextUtils.join(",", out);
    }

    /** Copies the runtime's log to logcat and keeps the last lines for error messages. */
    private static void drain(InputStream in) {
        Thread t = new Thread(() -> {
            try (BufferedReader r = new BufferedReader(new InputStreamReader(in, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) {
                    Log.i(TAG, line);
                    synchronized (LocalRuntime.class) {
                        lastLines.addLast(line);
                        while (lastLines.size() > 12) lastLines.removeFirst();
                    }
                }
            } catch (IOException ignored) {
                // the process ended
            }
        }, "odyssey-runtime-log");
        t.setDaemon(true);
        t.start();
    }
}
