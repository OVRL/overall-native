import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import CameraModal from "../components/CameraModal";
import { useColorScheme } from "@/hooks/use-color-scheme";
import { BridgeMessage } from "../types/bridge";
import { handleBridgeMessage } from "../utils/bridgeHandler";
import { APPLICATION_NAME_FOR_USER_AGENT } from "../utils/webViewUserAgent";

const BACKGROUND = {
  light: "#fcfcfc",
  dark: "#010101",
} as const;

// Push Notification Handler Setup
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldPlaySound: true,
    shouldSetBadge: false,
    shouldShowBanner: true,
    shouldShowList: true,
  }),
});

export default function App() {
  const navigation = useNavigation();
  const colorScheme = useColorScheme() ?? "light";
  const backgroundColor = BACKGROUND[colorScheme];
  const webViewRef = useRef<WebView>(null);
  const [isCameraVisible, setIsCameraVisible] = useState(false);
  const [currentReqId, setCurrentReqId] = useState<string | null>(null);

  // Deep Link Handling
  useEffect(() => {
    const handleDeepLink = (event: { url: string }) => {
      const url = event.url;
      // Send Deep Link Event to Web
      if (webViewRef.current) {
        const script = `
           window.dispatchEvent(new CustomEvent('message', { detail: { type: 'DEEP_LINK_RECEIVED', payload: { url: "${url}" } } }));
           window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'DEEP_LINK_RECEIVED', payload: { url: "${url}" } }));
        `;
        webViewRef.current.injectJavaScript(script);
      }
    };

    const subscribe = Linking.addEventListener("url", handleDeepLink);

    // Check initial URL
    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLink({ url });
    });

    return () => subscribe.remove();
  }, []);

  // Back Button Handling (Android)
  useEffect(() => {
    const onBackPress = () => {
      if (webViewRef.current) {
        webViewRef.current.goBack();
        return true; // prevent default behavior
      }
      return false;
    };

    if (Platform.OS === "android") {
      BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () =>
        BackHandler.removeEventListener("hardwareBackPress", onBackPress);
    }
  }, []);

  const onMessage = async (event: any) => {
    try {
      const data = JSON.parse(event.nativeEvent.data) as BridgeMessage;

      if (data.type === "OPEN_CAMERA") {
        setCurrentReqId(data.reqId || null);
        setIsCameraVisible(true);
        return;
      }

      // Handle other standard actions
      await handleBridgeMessage(webViewRef as any, data, navigation);
    } catch (e) {
      console.error("Failed to parse bridge message", e);
    }
  };

  const handlePhotoTaken = (uri: string) => {
    setIsCameraVisible(false);
    if (webViewRef.current && currentReqId) {
      // Send result back to Web
      const response = {
        type: "CAMERA_RESULT",
        payload: { uri }, // In real app, might want to upload or convert to base64
        reqId: currentReqId,
      };
      const script = `
        window.postMessage(JSON.stringify(${JSON.stringify(response)}), '*');
      `;
      webViewRef.current.injectJavaScript(script);
    }
  };

  return (
    <View style={[styles.screenRoot, { backgroundColor }]}>
      <SafeAreaView edges={["top"]} style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <WebView
        ref={webViewRef}
        source={{ uri: "http://localhost:3000/home" }}
        style={styles.webview}
        javaScriptEnabled={true}
        onMessage={onMessage}
        // Essential for some OAuth flows or heavy sites
        domStorageEnabled={true}
        startInLoadingState={true}
        allowsBackForwardNavigationGestures={true}
        // Inject a flag so web knows it's in RN
        injectedJavaScriptBeforeContentLoaded={`window.isNativeApp = true;`}
        applicationNameForUserAgent={APPLICATION_NAME_FOR_USER_AGENT}
      />

        <CameraModal
          visible={isCameraVisible}
          onClose={() => setIsCameraVisible(false)}
          onPhotoTaken={handlePhotoTaken}
        />
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  screenRoot: {
    flex: 1,
  },
  container: {
    flex: 1,
  },
  webview: {
    flex: 1,
  },
});
