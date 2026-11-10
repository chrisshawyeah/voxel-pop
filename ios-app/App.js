// Crumble Crew on the iPhone: the app is a full-screen window onto the game's web page, so
// every change pushed to the game shows up with no new install. The page itself decides when a
// new version loads (js/main.js, checkForUpdate): only at a level boundary, never in the middle
// of a level. Coming back to the front, the app asks the page to check. When iOS has stopped the
// page's process in the background, the app loads it again and the page puts the level back
// where it was from what it saved after each send.
import { useEffect, useRef } from 'react';
import { AppState, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { WebView } from 'react-native-webview';

const GAME = 'https://chrisshawyeah.github.io/voxel-pop/';
const SKY = '#a9d6ff';

export default function App() {
  const web = useRef(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', next => {
      if (next === 'active') web.current?.injectJavaScript('window.crumble && window.crumble.checkForUpdate(); true;');
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
