import { useColorScheme } from "@/hooks/use-color-scheme";
import { Camera } from "expo-camera";
import * as ImagePicker from "expo-image-picker";
import * as Linking from "expo-linking";
import * as Notifications from "expo-notifications";
import { Stack, useNavigation } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { Alert, BackHandler, Platform, StyleSheet, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import CameraModal from "../components/CameraModal";
import PhotoPickerBottomSheet, {
  PhotoPickerAction,
} from "../components/PhotoPickerBottomSheet";
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
  const [isPhotoPickerVisible, setIsPhotoPickerVisible] = useState(false);
  const [fileInputReqId, setFileInputReqId] = useState<string | null>(null);
  const [cameraOpenedFromFileInput, setCameraOpenedFromFileInput] =
    useState(false);

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
        setCameraOpenedFromFileInput(false);
        setCurrentReqId(data.reqId || null);
        setIsCameraVisible(true);
        return;
      }

      if (data.type === "OPEN_PHOTO_PICKER") {
        setFileInputReqId(data.reqId ?? null);
        setIsPhotoPickerVisible(true);
        return;
      }

      // Handle other standard actions
      await handleBridgeMessage(webViewRef as any, data, navigation);
    } catch (e) {
      console.error("Failed to parse bridge message", e);
    }
  };

  /** 웹 브릿지 requestWithResponse용 응답 전달 (PHOTO_PICKER_RESULT) */
  const sendPhotoPickerResultToWeb = (
    reqId: string,
    base64: string,
    mimeType: string
  ) => {
    if (!webViewRef.current) return;
    const response = {
      type: "PHOTO_PICKER_RESULT",
      reqId,
      payload: { base64, mimeType },
    };
    const script = `
      window.postMessage(JSON.stringify(${JSON.stringify(response)}), '*');
    `;
    webViewRef.current.injectJavaScript(script);
  };

  /** 갤러리 권한 거부 등 실패 시 웹에 ERROR 응답 전달 (requestWithResponse가 reject 하도록) */
  const sendPhotoPickerErrorToWeb = (reqId: string, errorMessage: string) => {
    if (!webViewRef.current) return;
    const response = {
      type: "ERROR",
      reqId,
      payload: null,
      error: errorMessage,
    };
    webViewRef.current.injectJavaScript(
      `window.postMessage(JSON.stringify(${JSON.stringify(response)}), '*');`
    );
  };

  const handlePhotoTaken = (uri: string, base64?: string) => {
    setIsCameraVisible(false);
    if (webViewRef.current && currentReqId) {
      if (cameraOpenedFromFileInput && base64) {
        sendPhotoPickerResultToWeb(currentReqId, base64, "image/jpeg");
        setCameraOpenedFromFileInput(false);
        setFileInputReqId(null);
      } else {
        const response = {
          type: "CAMERA_RESULT",
          payload: { uri },
          reqId: currentReqId,
        };
        webViewRef.current.injectJavaScript(
          `window.postMessage(JSON.stringify(${JSON.stringify(response)}), '*');`
        );
      }
      setCurrentReqId(null);
    }
  };

  const handlePhotoPickerSelect = async (action: PhotoPickerAction) => {
    if (action === "cancel" || !fileInputReqId) return;

    if (action === "camera") {
      if (!fileInputReqId) return;
      const reqId = fileInputReqId;
      setIsPhotoPickerVisible(false);

      // 카메라 권한 먼저 요청 (CameraModal의 권한 UI 대신 여기서 처리)
      const { status, canAskAgain } =
        await Camera.requestCameraPermissionsAsync();

      if (status !== "granted") {
        setFileInputReqId(null);
        if (canAskAgain === false) {
          sendPhotoPickerErrorToWeb(
            reqId,
            "카메라 접근 권한이 거부되었습니다. 설정에서 카메라 접근을 허용해 주세요."
          );
          Alert.alert(
            "카메라 권한 필요",
            "사진을 촬영하려면 설정에서 카메라 접근을 허용해 주세요.",
            [
              { text: "취소", style: "cancel" },
              { text: "설정 열기", onPress: () => Linking.openSettings() },
            ]
          );
        } else {
          sendPhotoPickerErrorToWeb(
            reqId,
            "카메라 접근 권한이 필요합니다. 권한을 허용해 주세요."
          );
        }
        return;
      }

      setCurrentReqId(reqId);
      setCameraOpenedFromFileInput(true);
      setIsCameraVisible(true);
      return;
    }

    if (action === "gallery") {
      if (!fileInputReqId) return;
      const reqId: string = fileInputReqId;

      try {
        // 1) 권한 먼저 요청 (바텀시트가 열린 상태에서 하면 iOS에서 시스템 팝업이 잘 뜸)
        const { status, canAskAgain } =
          await ImagePicker.requestMediaLibraryPermissionsAsync();

        setIsPhotoPickerVisible(false);

        if (status !== "granted") {
          setFileInputReqId(null);
          if (canAskAgain === false) {
            sendPhotoPickerErrorToWeb(
              reqId,
              "갤러리 접근 권한이 거부되었습니다. 설정에서 사진 접근을 허용해 주세요."
            );
            Alert.alert(
              "사진 접근 권한 필요",
              "사진을 선택하려면 설정에서 사진 접근을 허용해 주세요.",
              [
                { text: "취소", style: "cancel" },
                { text: "설정 열기", onPress: () => Linking.openSettings() },
              ]
            );
          } else {
            sendPhotoPickerErrorToWeb(
              reqId,
              "갤러리 접근 권한이 필요합니다. 권한을 허용해 주세요."
            );
          }
          return;
        }

        // 2) 권한 허용됨 → 갤러리 열기 (바텀시트 닫힌 뒤 호출)
        const result = await ImagePicker.launchImageLibraryAsync({
          mediaTypes: ["images"],
          allowsEditing: false,
          base64: true,
          quality: 0.9,
        });
        if (
          !result.canceled &&
          result.assets[0]?.base64 &&
          webViewRef.current
        ) {
          const asset = result.assets[0];
          const mimeType = asset.mimeType ?? "image/jpeg";
          sendPhotoPickerResultToWeb(
            reqId,
            asset.base64 as string,
            mimeType
          );
        } else {
          sendPhotoPickerErrorToWeb(reqId, "사진 선택이 취소되었습니다.");
        }
      } catch (err) {
        const message =
          err instanceof Error ? err.message : "갤러리를 열 수 없습니다.";
        sendPhotoPickerErrorToWeb(reqId, message);
      } finally {
        setFileInputReqId(null);
      }
    }
  };

  return (
    <View style={[styles.screenRoot, { backgroundColor }]}>
      <SafeAreaView edges={["top"]} style={styles.container}>
        <Stack.Screen options={{ headerShown: false }} />
        <WebView
          ref={webViewRef}
          source={{ uri: "http://localhost:3000/onboarding" }}
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
          returnBase64={cameraOpenedFromFileInput}
        />
        <PhotoPickerBottomSheet
          visible={isPhotoPickerVisible}
          onClose={() => {
            setIsPhotoPickerVisible(false);
            setFileInputReqId(null);
          }}
          onSelect={handlePhotoPickerSelect}
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
