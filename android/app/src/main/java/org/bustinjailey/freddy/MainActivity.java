package org.bustinjailey.freddy;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(FreddyStreamPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
