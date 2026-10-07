package com.groundup.dashboard;

import java.io.File;
import java.util.Locale;

/** File-name helpers with no Android dependencies (so they can be checked with plain javac + java). */
final class FileNames {
    private FileNames() {}

    static final int MAX_LENGTH = 120;

    /** A safe single file name: no path separators or control characters, no leading dots, not too long. */
    static String sanitise(String name, String fallback) {
        String n = name == null ? "" : name;
        StringBuilder sb = new StringBuilder(n.length());
        for (int i = 0; i < n.length(); i++) {
            char c = n.charAt(i);
            if (c < 0x20 || c == 0x7f || "\\/:*?\"<>|".indexOf(c) >= 0) sb.append('-');
            else sb.append(c);
        }
        n = sb.toString().replaceAll("\\s+", " ").trim();
        n = n.replaceFirst("^[.\\s]+", "").replaceFirst("[.\\s]+$", "");
        if (n.isEmpty()) n = fallback == null || fallback.isEmpty() ? "download" : fallback;
        if (n.length() > MAX_LENGTH) {
            String ext = extension(n);
            if (ext.length() > 12) ext = "";
            String base = n.substring(0, n.length() - (ext.isEmpty() ? 0 : ext.length() + 1));
            int keep = MAX_LENGTH - (ext.isEmpty() ? 0 : ext.length() + 1);
            n = base.substring(0, Math.min(base.length(), keep)).trim() + (ext.isEmpty() ? "" : "." + ext);
        }
        return n;
    }

    /** The extension without its dot ("" when there is none). */
    static String extension(String name) {
        int dot = name.lastIndexOf('.');
        return dot > 0 && dot < name.length() - 1 ? name.substring(dot + 1) : "";
    }

    static String baseName(String name) {
        String ext = extension(name);
        return ext.isEmpty() ? name : name.substring(0, name.length() - ext.length() - 1);
    }

    /** A name that does not exist yet in dir: "a.csv", then "a (1).csv", "a (2).csv" ... */
    static File unique(File dir, String name) {
        File f = new File(dir, name);
        if (!f.exists()) return f;
        String base = baseName(name);
        String ext = extension(name);
        for (int i = 1; i < 10000; i++) {
            f = new File(dir, base + " (" + i + ")" + (ext.isEmpty() ? "" : "." + ext));
            if (!f.exists()) return f;
        }
        return new File(dir, base + " (" + System.currentTimeMillis() + ")" + (ext.isEmpty() ? "" : "." + ext));
    }

    /** "text/csv;charset=utf-8" -> "text/csv"; anything that is not a mime type -> "". */
    static String cleanMime(String mime) {
        if (mime == null) return "";
        String m = mime.split(";", 2)[0].trim().toLowerCase(Locale.ROOT);
        return m.matches("[a-z0-9][a-z0-9!#$&^_.+-]*/[a-z0-9*][a-z0-9!#$&^_.+*-]*") ? m : "";
    }
}
