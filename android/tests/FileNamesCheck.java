package com.groundup.dashboard;

import java.io.File;

/** Plain-Java check of the file-name helpers the app uses before saving into Downloads.
 *  Run:  javac -d /tmp/fn app/src/main/java/com/groundup/dashboard/FileNames.java tests/FileNamesCheck.java && java -cp /tmp/fn com.groundup.dashboard.FileNamesCheck */
public class FileNamesCheck {
    static int bad = 0;

    static void eq(String what, String got, String want) {
        if (!got.equals(want)) {
            bad++;
            System.out.println("FAIL " + what + ": got [" + got + "] want [" + want + "]");
        } else {
            System.out.println("ok   " + what);
        }
    }

    public static void main(String[] a) throws Exception {
        eq("normal name", FileNames.sanitise("the-ground-up-backup-2026-10-07.json", "x"), "the-ground-up-backup-2026-10-07.json");
        eq("path traversal", FileNames.sanitise("../../etc/passwd", "x"), "-..-etc-passwd");
        eq("reserved characters", FileNames.sanitise("a/b\\c:d*e?f\"g<h>i|j.csv", "x"), "a-b-c-d-e-f-g-h-i-j.csv");
        eq("blank -> fallback", FileNames.sanitise("   ", "download"), "download");
        eq("null -> fallback", FileNames.sanitise(null, "download"), "download");
        eq("leading dot", FileNames.sanitise(".hidden", "d"), "hidden");
        eq("spaces and brackets kept", FileNames.sanitise("Claim pack (March) Acme.zip", "d"), "Claim pack (March) Acme.zip");
        eq("control characters", FileNames.sanitise("tab\there\nnewline.txt", "d"), "tab-here-newline.txt");
        String s = FileNames.sanitise("x".repeat(300) + ".pdf", "d");
        eq("long name length", String.valueOf(s.length()), "120");
        eq("long name keeps extension", FileNames.extension(s), "pdf");
        eq("mime parameters dropped", FileNames.cleanMime("text/csv;charset=utf-8"), "text/csv");
        eq("mime lower-cased", FileNames.cleanMime("Application/JSON"), "application/json");
        eq("not a mime", FileNames.cleanMime("nonsense"), "");
        eq("empty mime", FileNames.cleanMime(""), "");
        eq("svg mime", FileNames.cleanMime("image/svg+xml"), "image/svg+xml");
        File d = new File(System.getProperty("java.io.tmpdir"), "fn" + System.nanoTime());
        d.mkdirs();
        eq("unique: free name", FileNames.unique(d, "a.csv").getName(), "a.csv");
        new File(d, "a.csv").createNewFile();
        eq("unique: second", FileNames.unique(d, "a.csv").getName(), "a (1).csv");
        new File(d, "a (1).csv").createNewFile();
        eq("unique: third", FileNames.unique(d, "a.csv").getName(), "a (2).csv");
        new File(d, "noext").createNewFile();
        eq("unique: no extension", FileNames.unique(d, "noext").getName(), "noext (1)");
        System.out.println(bad == 0 ? "ALL OK" : bad + " FAILED");
        System.exit(bad == 0 ? 0 : 1);
    }
}
