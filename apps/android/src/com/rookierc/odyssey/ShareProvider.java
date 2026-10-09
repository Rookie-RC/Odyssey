package com.rookierc.odyssey;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.database.MatrixCursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;

import java.io.File;
import java.io.FileNotFoundException;
import java.io.IOException;
import java.net.URLConnection;

/**
 * Read-only access to files the app wrote to cache/share/ for the system
 * share sheet (content://com.rookierc.odyssey.share/&lt;name&gt;). Not
 * exported: other apps only get the one URI granted with each share.
 */
public class ShareProvider extends ContentProvider {
    static final String AUTHORITY = "com.rookierc.odyssey.share";

    static File dir(android.content.Context ctx) {
        return new File(ctx.getCacheDir(), "share");
    }

    static Uri uriFor(String name) {
        return new Uri.Builder().scheme("content").authority(AUTHORITY).appendPath(name).build();
    }

    private File fileFor(Uri uri) throws FileNotFoundException {
        String name = uri.getLastPathSegment();
        if (name == null || getContext() == null) throw new FileNotFoundException(String.valueOf(uri));
        File root = dir(getContext());
        File f = new File(root, name);
        try {
            if (!f.getCanonicalFile().getParentFile().equals(root.getCanonicalFile())) {
                throw new FileNotFoundException(String.valueOf(uri));
            }
        } catch (IOException e) {
            throw new FileNotFoundException(String.valueOf(uri));
        }
        if (!f.isFile()) throw new FileNotFoundException(String.valueOf(uri));
        return f;
    }

    @Override
    public boolean onCreate() {
        return true;
    }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        return ParcelFileDescriptor.open(fileFor(uri), ParcelFileDescriptor.MODE_READ_ONLY);
    }

    @Override
    public String getType(Uri uri) {
        String t = URLConnection.guessContentTypeFromName(String.valueOf(uri.getLastPathSegment()));
        return t != null ? t : "application/octet-stream";
    }

    // Some apps ask for the file's name and size before reading it.
    @Override
    public Cursor query(Uri uri, String[] projection, String selection, String[] args, String sort) {
        File f;
        try {
            f = fileFor(uri);
        } catch (FileNotFoundException e) {
            return null;
        }
        String[] cols = projection != null ? projection : new String[] {OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE};
        MatrixCursor c = new MatrixCursor(cols, 1);
        Object[] row = new Object[cols.length];
        for (int i = 0; i < cols.length; i++) {
            if (OpenableColumns.DISPLAY_NAME.equals(cols[i])) row[i] = f.getName();
            else if (OpenableColumns.SIZE.equals(cols[i])) row[i] = f.length();
        }
        c.addRow(row);
        return c;
    }

    @Override
    public Uri insert(Uri uri, ContentValues values) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int update(Uri uri, ContentValues values, String selection, String[] args) {
        throw new UnsupportedOperationException("read-only");
    }

    @Override
    public int delete(Uri uri, String selection, String[] args) {
        throw new UnsupportedOperationException("read-only");
    }
}
