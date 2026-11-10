// Crumble Crew on the iPhone: the app is a full-screen window onto the game's web page, so
// every change pushed to the game shows up the next time the app opens, with no new install.
import { StatusBar } from 'expo-status-bar';
import { View } from 'react-native';
import { WebView } from 'react-native-webview';

const GAME = 'https://chrisshawyeah.github.io/voxel-pop/';
const SKY = '#a9d6ff';

export default function App() {
  return (
    <View style={{ flex: 1, backgroundColor: SKY }}>
      <StatusBar style="dark" />
      <WebView
        source={{ uri: GAME }}
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
