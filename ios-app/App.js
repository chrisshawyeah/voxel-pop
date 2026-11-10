// Crumble Crew on the iPhone: the app is a full-screen window onto the game's web page, so
// every change pushed to the game shows up with no new install. The page loads again when the
// app opens fresh, when it comes back after more than a few minutes away, and when iOS has
// stopped the page's process in the background.
import { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const GAME = 'https://chrisshawyeah.github.io/voxel-pop/';
const SKY = '#a9d6ff';
const STALE_MS = 5 * 60 * 1000; // away longer than this: fetch the game again on return

export default function App() {
  const web = useRef(null);
  const away = useRef(0);
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'background') away.current = Date.now();
      if (next !== 'active') return;
      if (away.current && Date.now() - away.current > STALE_MS) web.current?.reload();
      away.current = 0;
    });
    return () => sub.remove();
  }, []);
  return (
    <View style={{ flex: 1, backgroundColor: SKY }}>
      <StatusBar style="dark" />
      <WebView
        ref={web}
        source={{ uri: GAME }}
        onContentProcessDidTerminate={() => web.current?.reload()}
        style={{ flex: 1, backgroundColor: SKY }}
        bounces={false}
        scrollEnabled={false}
        overScrollMode="never"
        contentInsetAdjustmentBehavior="never"
        automaticallyAdjustContentInsets={false}
        allowsInlineMediaPlayback
        mediaPlaybackRequiresUserAction={false}
        allowsBackForwardNavigationGestures={false}
        setSupportMultipleWindows={false}
      />
    </View>
  );
}
