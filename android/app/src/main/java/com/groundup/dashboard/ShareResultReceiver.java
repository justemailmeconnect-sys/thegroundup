package com.groundup.dashboard;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/** Fired by the system when the user picks an app in the share sheet (see GUBridge.startChooser). */
public final class ShareResultReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context context, Intent intent) {
        GUBridge.notifyShareChosen();
    }
}
