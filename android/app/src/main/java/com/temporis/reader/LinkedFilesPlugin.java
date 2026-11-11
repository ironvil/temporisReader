package com.temporis.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;
import android.provider.OpenableColumns;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileNotFoundException;

/**
 * Files the app reads in place instead of copying (EPUBs). Picks a document through the Storage
 * Access Framework and keeps a persistable read grant, so the same content:// URI can be read
 * again after restarts. The bytes are read by the WebView through Capacitor's local server
 * (convertFileSrc), so they never cross the bridge as base64.
 *
 * Also receives EPUBs opened with or shared to the app (see the intent filters in
 * AndroidManifest.xml): the app is told through "fileOpened", or takeOpened() at startup.
 */
@CapacitorPlugin(name = "LinkedFiles")
public class LinkedFilesPlugin extends Plugin {

    /** A file opened with the app before the web app was listening for it. */
    private JSObject pendingOpened;

    @Override
    public void load() {
        Intent intent = getActivity().getIntent();
        // Reopening the app from recents delivers the intent it was first launched with again.
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) == 0) receive(intent);
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        receive(intent);
    }

    /** The file opened with the app at launch, if any (once). */
    @PluginMethod
    public void takeOpened(PluginCall call) {
        JSObject out = new JSObject();
        if (pendingOpened != null) out.put("file", pendingOpened);
        pendingOpened = null;
        call.resolve(out);
    }

    private void receive(Intent intent) {
        Uri uri = openedUri(intent);
        if (uri == null) return;
        // Handled: a recreated activity doesn't import it again.
        intent.setAction(null);
        intent.setData(null);
        intent.removeExtra(Intent.EXTRA_STREAM);

        // Lasting access is only possible if the sending app offered it; otherwise the file can be
        // read until the app closes, and must be found again later.
        boolean persisted = false;
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            persisted = true;
        } catch (SecurityException e) {
            // Not offered.
        }
        JSObject info = describe(uri);
        if (info == null) return;
        if (!info.has("size")) info.put("size", 0);
        info.put("persisted", persisted);
        if (hasListeners("fileOpened")) {
            notifyListeners("fileOpened", info);
        } else {
            pendingOpened = info;
        }
    }

    private static Uri openedUri(Intent intent) {
        if (intent == null) return null;
        if (Intent.ACTION_VIEW.equals(intent.getAction())) return intent.getData();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri stream = intent.getParcelableExtra(Intent.EXTRA_STREAM);
            return stream != null ? stream : intent.getData();
        }
        return null;
    }

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT);
        intent.addCategory(Intent.CATEGORY_OPENABLE);
        // .md files have no reliable MIME type, so nothing is filtered out.
        intent.setType("*/*");
        intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
        startActivityForResult(call, intent, "pickResult");
    }

    @ActivityCallback
    private void pickResult(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        if (result.getResultCode() != android.app.Activity.RESULT_OK || data == null || data.getData() == null) {
            call.resolve(new JSObject().put("cancelled", true));
            return;
        }
        Uri uri = data.getData();
        boolean persisted = false;
        try {
            getContext().getContentResolver().takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION);
            persisted = true;
        } catch (SecurityException e) {
            // Some providers don't offer persistable grants; the file is readable until the app restarts.
        }
        JSObject info = describe(uri);
        if (info == null) {
            call.reject("The chosen file can't be read");
            return;
        }
        info.put("cancelled", false);
        info.put("persisted", persisted);
        call.resolve(info);
    }

    /** status: "ok" (readable), "missing" (deleted or moved) or "denied" (access was revoked). */
    @PluginMethod
    public void stat(PluginCall call) {
        String value = call.getString("uri");
        if (value == null) {
            call.reject("uri is required");
            return;
        }
        Uri uri = Uri.parse(value);
        JSObject out = new JSObject();
        try (ParcelFileDescriptor fd = getContext().getContentResolver().openFileDescriptor(uri, "r")) {
            if (fd == null) {
                out.put("status", "missing");
            } else {
                JSObject info = describe(uri);
                out.put("status", "ok");
                out.put("size", info != null && info.has("size") ? info.getLong("size") : fd.getStatSize());
                if (info != null) out.put("name", info.getString("name"));
            }
        } catch (SecurityException e) {
            out.put("status", "denied");
        } catch (FileNotFoundException | IllegalArgumentException e) {
            out.put("status", "missing");
        } catch (Exception e) {
            out.put("status", "missing");
        }
        call.resolve(out);
    }

    @PluginMethod
    public void release(PluginCall call) {
        String value = call.getString("uri");
        if (value != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(value), Intent.FLAG_GRANT_READ_URI_PERMISSION);
            } catch (SecurityException e) {
                // Not held (any more).
            }
        }
        call.resolve();
    }

    private JSObject describe(Uri uri) {
        ContentResolver resolver = getContext().getContentResolver();
        try (Cursor cursor = resolver.query(uri, new String[] { OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE }, null, null, null)) {
            JSObject info = new JSObject();
            info.put("uri", uri.toString());
            String name = uri.getLastPathSegment();
            if (cursor != null && cursor.moveToFirst()) {
                int nameIndex = cursor.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                int sizeIndex = cursor.getColumnIndex(OpenableColumns.SIZE);
                if (nameIndex >= 0 && !cursor.isNull(nameIndex)) name = cursor.getString(nameIndex);
                if (sizeIndex >= 0 && !cursor.isNull(sizeIndex)) info.put("size", cursor.getLong(sizeIndex));
            }
            info.put("name", name == null ? "book" : name);
            return info;
        } catch (SecurityException | IllegalArgumentException e) {
            return null;
        }
    }
}
