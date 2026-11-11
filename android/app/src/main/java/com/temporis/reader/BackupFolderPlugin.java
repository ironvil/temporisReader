package com.temporis.reader;

import android.content.ContentResolver;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.provider.DocumentsContract.Document;
import androidx.activity.result.ActivityResult;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.FileNotFoundException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * The folder automatic backups are written to (src/auto-backup.ts). The user picks it once with the
 * Storage Access Framework; the app keeps a persistable read/write grant on the tree, so it can
 * write a backup file there on later launches without asking again. Works with any provider that
 * supports folders (local storage, SD cards, Google Drive, Nextcloud…).
 *
 * Failures are rejected with a code: "denied" (the grant was revoked, or the tree's provider is
 * gone) or "missing" (the folder was deleted or moved).
 */
@CapacitorPlugin(name = "BackupFolder")
public class BackupFolderPlugin extends Plugin {

    private static final int GRANT = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(GRANT | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION);
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
        Uri tree = data.getData();
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, GRANT);
        } catch (SecurityException e) {
            call.reject("This folder can’t be kept for later. Choose another one.", "denied");
            return;
        }
        String name = displayName(tree);
        JSObject out = new JSObject();
        out.put("cancelled", false);
        out.put("uri", tree.toString());
        out.put("name", name == null ? "Backup folder" : name);
        call.resolve(out);
    }

    /** Writes `data` (UTF-8) to `name` in the folder, replacing a file of that name. */
    @PluginMethod
    public void write(PluginCall call) {
        String folder = call.getString("folder");
        String name = call.getString("name");
        String data = call.getString("data");
        if (folder == null || name == null || data == null) {
            call.reject("folder, name and data are required");
            return;
        }
        Uri tree = Uri.parse(folder);
        ContentResolver resolver = getContext().getContentResolver();
        try {
            String existing = childId(tree, name);
            if (existing != null) DocumentsContract.deleteDocument(resolver, DocumentsContract.buildDocumentUriUsingTree(tree, existing));
            Uri doc = DocumentsContract.createDocument(resolver, folderUri(tree), "application/json", name);
            if (doc == null) throw new FileNotFoundException("Couldn’t create " + name);
            try (OutputStream out = resolver.openOutputStream(doc, "wt")) {
                if (out == null) throw new FileNotFoundException("Couldn’t write " + name);
                out.write(data.getBytes(StandardCharsets.UTF_8));
            }
            String written = displayName(doc);
            call.resolve(new JSObject().put("name", written == null ? name : written));
        } catch (Exception e) {
            fail(call, e);
        }
    }

    /** The folder's files: name, size and last-modified time (ms). */
    @PluginMethod
    public void list(PluginCall call) {
        String folder = call.getString("folder");
        if (folder == null) {
            call.reject("folder is required");
            return;
        }
        Uri tree = Uri.parse(folder);
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] columns = { Document.COLUMN_DISPLAY_NAME, Document.COLUMN_SIZE, Document.COLUMN_LAST_MODIFIED, Document.COLUMN_MIME_TYPE };
        JSArray files = new JSArray();
        try (Cursor cursor = getContext().getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new FileNotFoundException("The folder can’t be read");
            while (cursor.moveToNext()) {
                if (Document.MIME_TYPE_DIR.equals(cursor.getString(3))) continue;
                JSObject file = new JSObject();
                file.put("name", cursor.getString(0));
                file.put("size", cursor.isNull(1) ? 0 : cursor.getLong(1));
                file.put("modified", cursor.isNull(2) ? 0 : cursor.getLong(2));
                files.put(file);
            }
            call.resolve(new JSObject().put("files", files));
        } catch (Exception e) {
            fail(call, e);
        }
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String folder = call.getString("folder");
        String name = call.getString("name");
        if (folder == null || name == null) {
            call.reject("folder and name are required");
            return;
        }
        Uri tree = Uri.parse(folder);
        try {
            String id = childId(tree, name);
            if (id != null) DocumentsContract.deleteDocument(getContext().getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, id));
            call.resolve();
        } catch (Exception e) {
            fail(call, e);
        }
    }

    /** Gives up the app's access to the folder (the folder and its files are left alone). */
    @PluginMethod
    public void release(PluginCall call) {
        String folder = call.getString("folder");
        if (folder != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(Uri.parse(folder), GRANT);
            } catch (SecurityException e) {
                // Not held (any more).
            }
        }
        call.resolve();
    }

    private static Uri folderUri(Uri tree) {
        return DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
    }

    /** The document id of the folder's direct child called `name`, or null. */
    private String childId(Uri tree, String name) throws FileNotFoundException {
        Uri children = DocumentsContract.buildChildDocumentsUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
        String[] columns = { Document.COLUMN_DOCUMENT_ID, Document.COLUMN_DISPLAY_NAME };
        try (Cursor cursor = getContext().getContentResolver().query(children, columns, null, null, null)) {
            if (cursor == null) throw new FileNotFoundException("The folder can’t be read");
            while (cursor.moveToNext()) {
                if (name.equals(cursor.getString(1))) return cursor.getString(0);
            }
        }
        return null;
    }

    private String displayName(Uri uri) {
        Uri doc = DocumentsContract.isTreeUri(uri) && !DocumentsContract.isDocumentUri(getContext(), uri) ? folderUri(uri) : uri;
        try (Cursor cursor = getContext().getContentResolver().query(doc, new String[] { Document.COLUMN_DISPLAY_NAME }, null, null, null)) {
            if (cursor != null && cursor.moveToFirst() && !cursor.isNull(0)) return cursor.getString(0);
        } catch (Exception e) {
            // Fall through.
        }
        return null;
    }

    private static void fail(PluginCall call, Exception e) {
        if (e instanceof SecurityException) {
            call.reject("The app no longer has access to the backup folder", "denied", e);
        } else if (e instanceof FileNotFoundException || e instanceof IllegalArgumentException || e instanceof IllegalStateException) {
            call.reject("The backup folder was moved or deleted", "missing", e);
        } else {
            call.reject(e.getMessage() == null ? "Writing the backup failed" : e.getMessage(), "failed", e);
        }
    }
}
