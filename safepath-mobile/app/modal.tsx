import React, { useState, useEffect, useRef } from 'react';
import { StyleSheet, Text, View, Button, SafeAreaView } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';

export default function IndexScreen() {
  const [permission, requestPermission] = useCameraPermissions();
  const [isAssisting, setIsAssisting] = useState(false);
  
  // Using 'any' types here to keep the MVP simple and avoid TypeScript strict errors
  const cameraRef = useRef<any>(null);
  const intervalRef = useRef<any>(null);

  // CRITICAL: Replace this with your laptop's actual IPv4 address on your Wi-Fi network
  // Example: '192.168.1.15'
  const BACKEND_URL = 'http://YOUR_LAPTOP_IP:8000/analyze'; 

  useEffect(() => {
    // Cleanup interval when component unmounts
    return () => clearInterval(intervalRef.current);
  }, []);

  if (!permission) {
    return <View />; // Loading permissions
  }

  if (!permission.granted) {
    return (
      <View style={styles.container}>
        <Text style={{ textAlign: 'center', marginBottom: 20 }}>
          SafePath AI needs access to your camera to detect objects.
        </Text>
        <Button onPress={requestPermission} title="Grant Camera Permission" />
      </View>
    );
  }

  const captureAndSend = async () => {
    if (cameraRef.current) {
      try {
        // 1. Take a low-res photo
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.3, base64: false });
        
        // 2. Prepare it for upload
        const formData = new FormData();
        formData.append('file', {
          uri: photo.uri,
          name: 'capture.jpg',
          type: 'image/jpeg',
        } as any); // Type cast to bypass strict fetch typing for FormData in React Native

        // 3. Send to FastAPI backend
        const response = await fetch(BACKEND_URL, {
          method: 'POST',
          body: formData,
          headers: {
            'Content-Type': 'multipart/form-data',
          },
        });

        const result = await response.json();

        // 4. Speak the result using Text-to-Speech
        if (result.status === 'success' && result.message !== 'Path is clear.') {
           Speech.speak(result.message);
        }

      } catch (error) {
        console.error("Error capturing or sending:", error);
      }
    }
  };

  const toggleAssist = () => {
    if (isAssisting) {
      clearInterval(intervalRef.current);
      Speech.speak("Assist mode stopped.");
    } else {
      Speech.speak("Assist mode started.");
      captureAndSend(); 
      intervalRef.current = setInterval(captureAndSend, 3000); 
    }
    setIsAssisting(!isAssisting);
  };

  return (
    <SafeAreaView style={styles.container}>
      <CameraView style={styles.camera} ref={cameraRef} facing="back">
        <View style={styles.buttonContainer}>
          <Button 
            title={isAssisting ? "Stop Assist" : "Start Assist"} 
            onPress={toggleAssist} 
            color={isAssisting ? "red" : "green"}
          />
        </View>
      </CameraView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'center' },
  camera: { flex: 1 },
  buttonContainer: {
    flex: 1,
    flexDirection: 'row',
    backgroundColor: 'transparent',
    margin: 64,
    justifyContent: 'center',
    alignItems: 'flex-end',
  },
});