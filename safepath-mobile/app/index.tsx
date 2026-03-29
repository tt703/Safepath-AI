import { Ionicons } from '@expo/vector-icons';
import { Audio } from 'expo-av';
import { BlurView } from 'expo-blur';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as Speech from 'expo-speech';
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';

export default function IndexScreen() {
  const [cameraPerm, requestCameraPerm] = useCameraPermissions();
  const [micPerm, requestMicPerm] = Audio.usePermissions(); 
  
  // --- STATE WITH REFERENCE LOCKS ---
  const [isRecording, _setIsRecording] = useState(false);
  const isRecordingRef = useRef(false);
  const setIsRecording = (val: boolean) => { isRecordingRef.current = val; _setIsRecording(val); };

  const [isAssisting, _setIsAssisting] = useState(false);
  const isAssistingRef = useRef(false);
  const setIsAssisting = (val: boolean) => { isAssistingRef.current = val; _setIsAssisting(val); };

  const [activeMode, _setActiveMode] = useState<'IDLE' | 'NAV' | 'READ' | 'DESCRIBE' | 'SIGN'>('IDLE');
  const activeModeRef = useRef<'IDLE' | 'NAV' | 'READ' | 'DESCRIBE' | 'SIGN'>('IDLE');
  const setActiveMode = (val: any) => { activeModeRef.current = val; _setActiveMode(val); };

  const [overlayState, _setOverlayState] = useState<{ active: boolean; title: string; text: string; loading: boolean; icon?: string }>({
    active: false, title: '', text: '', loading: false,
  });
  const overlayActiveRef = useRef(false);
  const setOverlayState = (val: any) => { 
    if (typeof val === 'function') {
        _setOverlayState((prev) => { const next = val(prev); overlayActiveRef.current = next.active; return next; });
    } else {
        overlayActiveRef.current = val.active; _setOverlayState(val); 
    }
  };

  const [deafUserScreenText, setDeafUserScreenText] = useState("I am listening...");
  const [dropdownOpenState, setDropdownOpen] = useState(false);

  const cameraRef = useRef<any>(null);
  const recordingRef = useRef<Audio.Recording | null>(null);
  const navIntervalRef = useRef<any>(null);
  const signIntervalRef = useRef<any>(null);
  const recordingTimeoutRef = useRef<any>(null);
  
  const isProcessingTickRef = useRef(false);
  const lastSpokenSentenceRef = useRef<string>("");
  const idleTimerRef = useRef<any>(null);
  const introTimerRef = useRef<any>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  // CRITICAL: Check your IP or ensure it matches the PC one
  const BACKEND_IP = '192.168.9.91'; 
  const BASE_URL = `http://${BACKEND_IP}:8000`;

  // --Force Loud Speaker ---
  const forceSpeaker = async () => {
    try {
      await Audio.setAudioModeAsync({
        allowsRecordingIOS: false, // Tells OS: "We are NOT making a phone call"
        playsInSilentModeIOS: true,
        playThroughEarpieceAndroid: false, 
        staysActiveInBackground: false,
        shouldDuckAndroid: true,
      });
      
      // THE BLUR FIX: If the heavy BlurView is active, the phone's hardware is lagging.
      // We dynamically increase the wait time to guarantee the speaker relay clicks over.
      const hardwareBuffer = overlayActiveRef.current ? 400 : 100;
      await new Promise(resolve => setTimeout(resolve, hardwareBuffer)); 
    } catch (e) { 
      console.log("Audio mode error", e); 
    }
  };

  // Injected the forceSpeaker directly into Nova's vocal cords
  const speakWithNova = async (text: string, interrupt = false) => {
    // STRICT MUTEX LOCK: If the mic is currently open, Nova is absolutely forbidden 
    // from speaking (unless she is explicitly saying "Listening."). 
    // This prevents background tasks from stealing the audio session!
    if (isRecordingRef.current && text !== "Listening.") return;

    if (interrupt) Speech.stop(); 
    await forceSpeaker(); // Guarantee the speaker is on BEFORE she speaks
    Speech.speak(text, { language: 'en-ZA', pitch: 1.0, rate: 0.9 });
  };

 

  const playIntro = () => {
    speakWithNova("Hello, I am Nova. Tap the center button and say: navigate, read text, describe scene, or translate sign.", true);
    startIdleTimers(false, false);
  };

  const startIdleTimers = (currentlyAssisting: boolean, overlayActive: boolean) => {
    clearTimeout(idleTimerRef.current);
    clearTimeout(introTimerRef.current);
    if (currentlyAssisting || overlayActive) return;

    idleTimerRef.current = setTimeout(() => {
      speakWithNova("I am still here. You can say: navigate, read text, describe scene, or translate sign.", false);
      introTimerRef.current = setTimeout(() => { playIntro(); }, 15000);
    }, 15000);
  };

  const resetTimers = () => startIdleTimers(isAssistingRef.current, overlayActiveRef.current);

  useEffect(() => {
    forceSpeaker(); // Set on boot

    Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.15, duration: 1500, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 1500, useNativeDriver: true })
      ])
    ).start();

    playIntro();
    return () => {
      clearInterval(navIntervalRef.current);
      clearInterval(signIntervalRef.current);
      clearTimeout(idleTimerRef.current);
      clearTimeout(introTimerRef.current);
    };
  }, []);

  if (!cameraPerm || !micPerm) return <View />;
  if (!cameraPerm.granted || !micPerm.granted) return <View style={styles.permissionContainer}><Text style={{ color: 'white' }}>Grant Access</Text></View>;

  const killBackgroundLoops = () => {
    clearInterval(navIntervalRef.current);
    clearInterval(signIntervalRef.current);
  };

  // --- 1. VOICE CAPTURE ---
  const handleNovaVoiceCommand = async () => {
    if (isRecordingRef.current) {
        clearTimeout(recordingTimeoutRef.current);
        await processVoiceCommand();
        return;
    }
    
    clearTimeout(idleTimerRef.current);
    clearTimeout(introTimerRef.current);
    
    try {
      setIsRecording(true); 
      
      // 1. Force the speaker on and kill any current background speech
      Speech.stop();
      await forceSpeaker();
      
      
      // The code physically freezes on this Promise until Nova's vocal cords stop moving.
      await new Promise<void>((resolve) => {
          Speech.speak("Listening.", {
              language: 'en-ZA',
              pitch: 1.0,
              rate: 0.9,
              onDone: resolve,     
              onStopped: resolve,  
                 
          });
      });
      
      // 3. NOW that she is completely silent, we can safely open the mic for a "phone call"
      await Audio.setAudioModeAsync({ 
          allowsRecordingIOS: true, 
          playsInSilentModeIOS: true,
          playThroughEarpieceAndroid: false
      });
      
      const { recording } = await Audio.Recording.createAsync(Audio.RecordingOptionsPresets.HIGH_QUALITY);
      recordingRef.current = recording;

      recordingTimeoutRef.current = setTimeout(async () => {
        await processVoiceCommand();
      }, 2000);

    } catch (err) {
      setIsRecording(false);
    }
  };
      

  // --- 2. THE FLUID ROUTER ---
  const processVoiceCommand = async () => {
    if (!recordingRef.current || !isRecordingRef.current) return;
    setIsRecording(false); 
    
    try {
      await recordingRef.current.stopAndUnloadAsync();
      await forceSpeaker(); // Instantly revert to loud speaker
      
      const uri = recordingRef.current.getURI();
      
      if (activeModeRef.current !== 'SIGN') {
          setOverlayState((prev: any) => ({ ...prev, active: true, title: 'Nova is thinking', text: 'Processing voice...', loading: true, icon: 'mic' }));
      }
      
      const formData = new FormData();
      formData.append('file', { uri: uri, name: 'command.m4a', type: 'audio/m4a' } as any);

      const response = await fetch(`${BASE_URL}/listen`, { method: 'POST', body: formData });
      const result = await response.json();

      if (result.status === 'success') {
        const spokenWords = result.text;
        const textLower = spokenWords.toLowerCase();
        
        // Strip punctuation to check for exact exit commands safely
        const cleanText = textLower.replace(/[^a-z0-9\s]/g, '').trim();

        // A. UNIVERSAL EXIT (Takes you back to the Home Screen Dropdown)
        if (["stop", "exit", "cancel", "home"].includes(cleanText)) {
           speakWithNova("Exiting to home screen.", true);
           killBackgroundLoops();
           setIsAssisting(false);
           closeOverlay();
           return;
        }

        // B. THE SIGN QUARANTINE ZONE
        // If we are talking to a deaf person, bypass the command logic entirely.
        // This lets you say "navigate" in a sentence without Nova glitching out!
        if (activeModeRef.current === 'SIGN') {
            setDeafUserScreenText(spokenWords);
            return; 
        }

        // C. MASTER COMMAND INTERCEPTOR
        const action = result.action;
        if (action !== 'unknown') {
            if ((action === 'read_text' && activeModeRef.current === 'READ') || 
                (action === 'describe_scene' && activeModeRef.current === 'DESCRIBE')) {
                speakWithNova("Scanning again.", true);
                triggerEndpoint(`/${action}`, action === 'read_text' ? 'Reading Text' : 'Scene Description');
                return;
            }

            killBackgroundLoops();
            setIsAssisting(false);
            speakWithNova(`Switching to ${action.replace('_', ' ')}.`, true);
            
            if (action === 'read_text') triggerEndpoint('/read_text', 'Reading Text');
            else if (action === 'describe_scene') triggerEndpoint('/describe_scene', 'Scene Description');
            else if (action === 'translate_sign') startSignInterpreter();
            else if (action === 'toggle_nav') toggleAssist();
            return;
        }

        // D. SLAVE CONTEXTS
        if (activeModeRef.current === 'READ') {
            if (textLower.includes("next") || textLower.includes("continue")) {
                triggerEndpoint('/read_text', 'Reading Next Page');
            } else {
                speakWithNova("Say 'read text', 'next', or 'exit'.", true);
                setOverlayState((prev: any) => ({ ...prev, loading: false })); 
            }
            return;
        }

        if (activeModeRef.current === 'DESCRIBE') {
            if (textLower.includes("next") || textLower.includes("again") || textLower.includes("look")) {
                triggerEndpoint('/describe_scene', 'Describing New Scene');
            } else {
                speakWithNova("Say 'describe scene', 'next', or 'exit'.", true);
                setOverlayState((prev: any) => ({ ...prev, loading: false }));
            }
            return;
        }

        if (activeModeRef.current === 'NAV') {
            speakWithNova("Navigation is running. Say 'stop' to end it.", true);
            return;
        }

        // E. IDLE CATCH-ALL
        setOverlayState({ active: true, title: 'Unknown Command', text: `Heard: "${spokenWords}"`, loading: false, icon: 'help-circle' });
        speakWithNova("Please say read, describe, sign, or navigate.");
        startIdleTimers(activeModeRef.current !== 'IDLE', true);

      } else {
        setOverlayState((prev: any) => ({ ...prev, loading: false }));
        speakWithNova("I didn't catch that.", true);
      }
    } catch (error) {
      setOverlayState((prev: any) => ({ ...prev, loading: false }));
      speakWithNova("Connection failed.", true);
    }
  };

  // --- 3. BACKGROUND TICKS ---
  const runNavigationTick = async () => {
    if (!cameraRef.current || overlayActiveRef.current || isRecordingRef.current || !isAssistingRef.current || isProcessingTickRef.current) return;
    
    isProcessingTickRef.current = true; 
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.05, base64: false });
      const formData = new FormData();
      formData.append('file', { uri: photo.uri, name: 'nav.jpg', type: 'image/jpeg' } as any);
      const response = await fetch(`${BASE_URL}/analyze`, { method: 'POST', body: formData });
      const result = await response.json();
      if (result.status === 'success' && result.message !== 'Path is clear.') speakWithNova(result.message);
    } catch (error) { 
      console.log("Nav tick failed"); 
    } finally {
      isProcessingTickRef.current = false; 
    }
  };

  const runSignTick = async () => {
    if (!cameraRef.current || activeModeRef.current !== 'SIGN' || isRecordingRef.current || isProcessingTickRef.current) return;
    
    isProcessingTickRef.current = true; 
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.05, base64: false });
      const formData = new FormData();
      formData.append('file', { uri: photo.uri, name: 'sign.jpg', type: 'image/jpeg' } as any);

      const response = await fetch(`${BASE_URL}/translate_sign`, { method: 'POST', body: formData });
      const result = await response.json();

      if (result.status === 'success') {
        setOverlayState((prev: any) => ({ ...prev, text: result.message, loading: false, icon: 'hand-right' }));
        if (result.message !== lastSpokenSentenceRef.current && result.message !== "Sentence: " && !result.message.includes("Analyzing") && !result.message.includes("No hands")) {
          speakWithNova(result.message);
          lastSpokenSentenceRef.current = result.message; 
        }
      }
    } catch (error) { 
      console.log("Sign tick failed"); 
    } finally {
      isProcessingTickRef.current = false; 
    }
  };

  // --- 4. EXECUTORS ---
  const toggleAssist = () => {
    setDropdownOpen(false);
    killBackgroundLoops(); 
    isProcessingTickRef.current = false;
    
    if (isAssistingRef.current) {
      setIsAssisting(false);
      setActiveMode('IDLE'); 
      speakWithNova("Navigation stopped.", true);
      setOverlayState({ active: false, title: '', text: '', loading: false });
      startIdleTimers(false, false);
    } else {
      setIsAssisting(true); 
      setActiveMode('NAV'); 
      speakWithNova("Navigation started.", true);
      
      navIntervalRef.current = setInterval(runNavigationTick, 1500);
      setOverlayState({ active: false, title: '', text: '', loading: false });
      startIdleTimers(true, false); 
    }
  };

  const startSignInterpreter = () => {
    setDropdownOpen(false);
    killBackgroundLoops();
    setIsAssisting(false);
    isProcessingTickRef.current = false;
    
    lastSpokenSentenceRef.current = ""; 
    setActiveMode('SIGN'); 
    setDeafUserScreenText("I am listening...");

    setOverlayState({ active: true, title: 'Two-Way Interpreter', text: 'Signing...', loading: true, icon: 'people' });
    speakWithNova("Interpreter active.", true);
    startIdleTimers(true, true);

    signIntervalRef.current = setInterval(runSignTick, 1500); 
  };

  const triggerEndpoint = async (endpoint: string, title: string) => {
    setDropdownOpen(false);
    killBackgroundLoops();
    setIsAssisting(false);
    
    if (endpoint === '/read_text') setActiveMode('READ');
    if (endpoint === '/describe_scene') setActiveMode('DESCRIBE');

    setOverlayState({ active: true, title: title, text: 'Analyzing...', loading: true, icon: 'camera' });
    speakWithNova(`Looking now.`, true);
    startIdleTimers(false, true); 

    if (cameraRef.current) {
      try {
        const photo = await cameraRef.current.takePictureAsync({ quality: 0.5, base64: false });
        const formData = new FormData();
        formData.append('file', { uri: photo.uri, name: 'action.jpg', type: 'image/jpeg' } as any);

        const response = await fetch(`${BASE_URL}${endpoint}`, { method: 'POST', body: formData });
        const result = await response.json();

        if (result.status === 'success') {
          let dynamicIcon = endpoint === '/read_text' ? 'book' : 'eye';
          setOverlayState({ active: true, title: title, text: result.message, loading: false, icon: dynamicIcon });
          speakWithNova(result.message); 
        } else {
          setOverlayState({ active: true, title: 'Error', text: 'Could not analyze.', loading: false, icon: 'alert-circle' });
        }
      } catch (error) {
        setOverlayState({ active: true, title: 'Network Error', text: 'Server unreachable.', loading: false, icon: 'wifi' });
      }
    }
  };

  const closeOverlay = () => {
    killBackgroundLoops();
    setActiveMode('IDLE'); 
    setOverlayState({ active: false, title: '', text: '', loading: false });
    startIdleTimers(false, false);
  };

  return (
    <View style={styles.container}>
      <CameraView style={StyleSheet.absoluteFill} ref={cameraRef} facing="back" />
      <View style={styles.darkenCamera} />

      {!overlayState.active && (
        <View style={styles.topBar}>
          <TouchableOpacity style={styles.dropdownToggle} onPress={() => { resetTimers(); setDropdownOpen(!dropdownOpenState); }}>
            <Text style={styles.dropdownText}>Quick Actions</Text>
            <Ionicons name={dropdownOpenState ? "chevron-up" : "chevron-down"} size={20} color="white" />
          </TouchableOpacity>
          {dropdownOpenState && (
            <View style={styles.dropdownMenu}>
              <TouchableOpacity style={styles.dropdownItem} onPress={toggleAssist}>
                <Ionicons name={isAssisting ? "stop-circle" : "navigate"} size={24} color={isAssisting ? "#00ffcc" : "white"} />
                <Text style={styles.dropdownItemText}>{isAssisting ? "Stop Nav" : "Start Nav"}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dropdownItem} onPress={() => triggerEndpoint('/read_text', 'Reading Text')}>
                <Ionicons name="document-text" size={24} color="white" />
                <Text style={styles.dropdownItemText}>Read Text</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dropdownItem} onPress={() => triggerEndpoint('/describe_scene', 'Scene Description')}>
                <Ionicons name="scan" size={24} color="white" />
                <Text style={styles.dropdownItemText}>Describe</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.dropdownItem} onPress={startSignInterpreter}>
                <Ionicons name="hand-left" size={24} color="white" />
                <Text style={styles.dropdownItemText}>Translate Sign</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* MASTER MIC BUTTON */}
      {!overlayState.active && (
        <View style={styles.centerDock}>
          <Animated.View style={[styles.novaPulseRing, { transform: [{ scale: pulseAnim }], backgroundColor: isRecording ? 'rgba(255, 0, 85, 0.3)' : 'rgba(0, 85, 255, 0.2)' }]}>
            <TouchableOpacity style={[styles.novaButtonCore, { backgroundColor: isRecording ? '#ff0055' : '#0055ff' }]} onPress={handleNovaVoiceCommand} activeOpacity={0.8}>
              <Ionicons name={isRecording ? "recording" : "mic"} size={80} color="white" />
            </TouchableOpacity>
          </Animated.View>
          <Text style={styles.novaLabel}>
             {isRecording ? "Tap again to finish..." : "Tap to speak to Nova"}
          </Text>
        </View>
      )}

      {/* SLAVE OVERLAYS */}
      {overlayState.active && (
        <BlurView intensity={100} tint="dark" style={styles.blurOverlay}>
          
          {activeMode === 'SIGN' ? (
              <View style={{ flex: 1, width: '100%', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 40 }}>
                  <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
                      <Text style={{ color: '#00ffcc', fontSize: 20, fontWeight: 'bold', marginBottom: 10, textTransform: 'uppercase' }}>Nova Heard You Say:</Text>
                      <Text style={{ color: 'white', fontSize: 36, fontWeight: '900', textAlign: 'center', lineHeight: 45 }}>
                          "{deafUserScreenText}"
                      </Text>
                  </View>
                  <TouchableOpacity style={[styles.novaButtonCore, { width: 140, height: 140, borderRadius: 70, backgroundColor: isRecording ? '#ff0055' : '#0055ff' }]} onPress={handleNovaVoiceCommand}>
                      <Ionicons name={isRecording ? "recording" : "mic"} size={70} color="white" />
                  </TouchableOpacity>
                  <View style={{ marginTop: 40, alignItems: 'center' }}>
                      <Text style={{ color: '#aaa', fontSize: 16 }}>Translating Signs...</Text>
                      <Text style={{ color: 'white', fontSize: 24, fontWeight: '600', textAlign: 'center', marginTop: 10 }}>{overlayState.text}</Text>
                  </View>
              </View>
          ) : (
              <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', width: '100%' }}>
                  <Text style={styles.overlayTitle}>{overlayState.title}</Text>
                  {overlayState.loading ? (
                    <ActivityIndicator size="large" color="#00ffcc" style={{ marginVertical: 40 }} />
                  ) : (
                    <>
                      {overlayState.icon && <Ionicons name={overlayState.icon as any} size={80} color="#00ffcc" style={{ marginBottom: 20 }} />}
                      <Text style={styles.overlayText}>{overlayState.text}</Text>
                      
                      <Text style={{ color: '#aaa', fontSize: 16, marginBottom: 15 }}>
                          {isRecording ? "Tap again to finish" : "Tap to Command"}
                      </Text>
                      <TouchableOpacity style={[styles.novaButtonCore, { width: 140, height: 140, borderRadius: 70, backgroundColor: isRecording ? '#ff0055' : '#0055ff', marginBottom: 40 }]} onPress={handleNovaVoiceCommand}>
                          <Ionicons name={isRecording ? "recording" : "mic"} size={70} color="white" />
                      </TouchableOpacity>
                    </>
                  )}
              </View>
          )}
          <TouchableOpacity style={styles.closeButton} onPress={closeOverlay}>
            <Text style={styles.closeButtonText}>Stop & Exit</Text>
          </TouchableOpacity>
        </BlurView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: 'black' },
  permissionContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20, backgroundColor: 'black' },
  darkenCamera: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.3)' },
  topBar: { position: 'absolute', top: 60, width: '100%', alignItems: 'center', zIndex: 50 },
  dropdownToggle: { flexDirection: 'row', alignItems: 'center', backgroundColor: 'rgba(0,0,0,0.7)', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 20, borderWidth: 1, borderColor: '#444' },
  dropdownText: { color: 'white', fontWeight: 'bold', fontSize: 16, marginRight: 8 },
  dropdownMenu: { marginTop: 10, backgroundColor: 'rgba(0,0,0,0.85)', borderRadius: 15, width: 220, padding: 10, borderWidth: 1, borderColor: '#333' },
  dropdownItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 15, paddingHorizontal: 15, borderBottomWidth: 1, borderBottomColor: '#222' },
  dropdownItemText: { color: 'white', fontSize: 18, marginLeft: 15, fontWeight: '500' },
  centerDock: { position: 'absolute', top: 0, bottom: 0, left: 0, right: 0, justifyContent: 'center', alignItems: 'center', zIndex: 10 },
  novaPulseRing: { width: 220, height: 220, borderRadius: 110, justifyContent: 'center', alignItems: 'center' },
  novaButtonCore: { width: 160, height: 160, borderRadius: 80, justifyContent: 'center', alignItems: 'center', shadowColor: '#0055ff', shadowOpacity: 0.8, shadowRadius: 20, elevation: 10 },
  novaLabel: { color: 'white', fontSize: 18, marginTop: 40, fontWeight: '600', opacity: 0.8 },
  blurOverlay: { ...StyleSheet.absoluteFillObject, justifyContent: 'center', alignItems: 'center', padding: 30, zIndex: 100 },
  overlayTitle: { color: '#00ffcc', fontSize: 24, fontWeight: 'bold', marginBottom: 20, textTransform: 'uppercase', letterSpacing: 2 },
  overlayText: { color: 'white', fontSize: 28, fontWeight: '600', textAlign: 'center', marginBottom: 10, lineHeight: 40 },
  closeButton: { backgroundColor: 'white', paddingVertical: 15, paddingHorizontal: 40, borderRadius: 30 },
  closeButtonText: { color: 'black', fontSize: 18, fontWeight: 'bold' },
});