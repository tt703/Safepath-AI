**SafePath AI**


SafePath AI is a voice-controlled, multimodal accessibility ecosystem designed to bridge the gap between visually impaired and deaf users. Powered by a custom conversational agent named "Nova", the app fuses real-time computer vision, spatial depth mapping, and natural language processing into a single, seamless state machine.

**Youtube Link**
https://youtu.be/TQrA4Fa7jEs

**🎯 The Core Problem**


Standard accessibility applications are heavily fragmented. A visually impaired user typically needs one app to read text, another to navigate obstacles, and a completely different tool to describe their environment. Furthermore, real-time, two-way communication between a blind individual and a deaf individual is virtually impossible with standard tools.

Additionally, combining continuous camera streams, audio recording, and AI inference on a mobile device usually results in severe hardware crashes, overlapping audio, and melted CPUs.

**💡 The SafePath Solution**


SafePath AI solves this fragmentation through Fluid Mode Switching, Depth-First Sensor Fusion, and a Strict Mutex Architecture. Nova acts as a Master Controller, allowing the user to seamlessly switch between complex AI pipelines using only their voice, without dropped frames or audio collisions.

**🧠 Advanced Systems Architecture (How It Works)**


To make this app enterprise-grade and fail-proof, several complex engineering hurdles were solved:

**1. Depth-First Sensor Fusion (The "Mean" vs. "Percentile" Fix)**


Traditional object detection (YOLO) draws rectangular boxes around objects. However, a chair has gaps, meaning the bounding box captures both the chair (close) and the wall behind it (far). Averaging the depth of that box causes the AI to think the object is at a safe distance.

The Fix: SafePath divides the screen into a 3-Zone Grid (Left, Center, Right) and uses the 95th Percentile of the depth array. It mathematically isolates the closest 5% of pixels, completely ignoring the background.

The Result: Even if YOLO doesn't recognize a blank glass door or a thin pole, the Depth Grid instantly triggers a physical collision alarm, making the app incredibly sensitive and safe for a blind user.

**2. The Context-Aware State Machine***


Nova operates on a Master/Slave context architecture to prevent logic collisions.

Master Mode (IDLE): Nova listens for universal commands ("Navigate", "Read", "Sign").

Context Mode: Once inside a service (like Reading), Nova locks her state. If you say "Next", she knows you want to read the next page, not skip to a different app feature.

Fluid Switching: If you are reading a book and say "Navigate", Nova's Master Kill Switch dynamically tears down the OCR intervals and instantly boots up the YOLO/Depth pipeline without forcing you to return to a home screen first.

**3. The "Earpiece Trap" & Audio Hardware Locks**


When iOS/Android OS detects a microphone opening while audio is playing, it panics and forces all sound into the tiny phone earpiece (assuming a phone call is happening).

The Fix: SafePath implements a strict onDone Promise wrapper around the expo-speech engine. The React Native thread literally freezes until Nova's vocal cords stop moving. It then applies a dynamic 250ms hardware buffer, giving the physical phone relays time to click over, before safely opening the microphone.

**4. Mutex Locks & Re-entrancy Protection**


When a phone takes a picture every 1.5 seconds and sends it to a Python server, network lag can cause frames to pile up, crashing the app.

The Fix: A strict isProcessingTickRef acts as a traffic cop. The camera is mathematically forbidden from taking a new photo until the Python server has returned a 200 OK for the previous one.

**🌟 Core Features**


Smart Navigation: Fuses YOLOv8 with DepthAnything to provide real-time spatial awareness ("Obstacle dead ahead", "Couch on the left").

Two-Way Sign Language Communicator: A dedicated quarantine UI. It translates MediaPipe gesture recognition into spoken words for a blind user, and uses Whisper AI to transcribe the blind user's voice into massive, high-contrast text for the deaf user to read.

Context-Aware OCR & Scene Description: Uses EasyOCR and BLIP to read text and describe environments. Features a massive, 140x140 pixel context microphone button designed specifically for visually impaired users to easily tap and scan the next page.

**🏗️ Tech Stack**


Frontend (React Native / Expo)

Core: React Native, Expo Router.

Hardware Interfacing: expo-camera, expo-speech, expo-av (custom loud speaker forcing).

UI/UX: expo-blur for contextual overlays, Animated API for breathing UI effects.

Backend (Python FastAPI)

Server: uvicorn and FastAPI processing base64 image streams in milliseconds.

**AI Models:**



ultralytics (YOLOv8) - Object Detection

transformers (DepthAnything) - 3D Spatial Mapping

easyocr - Text Extraction

Salesforce/blip-image-captioning-base - Scene Description

mediapipe - Gesture Recognition

openai/whisper - Voice Transcription & Intent Routing (Fuzzy matching)

**🚀 Setup & Installation Guide**


Prerequisites
Node.js and npm installed.

Python 3.9+ installed.

CRITICAL: Your mobile device and your laptop must be connected to the exact same Wi-Fi network.

Step 1: Backend Setup (Python)
Open a terminal and navigate to the backend folder:

Bash
cd safepath-backend
Install the required AI dependencies:

Bash
pip install -r requirements.txt
Start the FastAPI server. You must bind it to 0.0.0.0 to allow external network traffic from your phone:

Bash
uvicorn main:app --host 0.0.0.0 --port 8000
Step 2: Frontend Setup (React Native)
Find your laptop's local IPv4 address.

Windows: Open Command Prompt and type ipconfig. Look for IPv4 Address.

Mac: Open Terminal and type ifconfig or check Network Settings.

Open safepath-mobile/app/index.tsx in your code editor.

At the top of the file, locate the BACKEND_IP variable and replace it with your exact IP address:

TypeScript
const BACKEND_IP = '192.168.X.X'; // Replace this!
Open a new terminal, navigate to the mobile folder, and install packages:

Bash
cd safepath-mobile
npm install
Start the Expo server using the Local Area Network flag:

Bash
npx expo start --lan
Step 3: Device Linking
Download the Expo Go app on your physical smartphone (Apple App Store or Google Play Store).

Open your phone's default Camera app (iOS) or the Expo Go app (Android) and scan the QR code generated in your laptop's terminal.

When the app boots, grant the requested Camera and Microphone permissions.

**📖 User Guide**


Nova is entirely voice-controlled. Tap the massive microphone button on the screen to wake her up, then speak your command. You can also tap the button again while recording to instantly process your voice without waiting.

Master Commands (Home Screen)
From the idle screen, say any of these to boot a specific AI engine:

"Navigate" - Starts the 3D depth grid and object detection to guide your walking path.

"Read Text" - Takes a high-res photo, applies high-contrast filters, and extracts text.

"Describe Scene" - Generates a conversational description of the room ahead.

"Translate Sign" - Opens the two-way deaf/blind communicator.

Contextual Commands (Inside a Service)
When you are actively using a service (like Reading), Nova locks into that context.

"Next" / "Again" / "Look" - Instantly repeats the current action (e.g., scanning the next page of a document).

Fluid Switching - To change tools, just say the new tool's name. Saying "Navigate" while reading a book will automatically close the reading tool and start navigation.

The Deaf/Blind Communicator
When you say "Translate Sign", Nova enters a quarantine state.

Camera: Watches the deaf person's hands and speaks translated gestures out loud.

Microphone: When the blind user taps the mic and replies, Nova stops listening for commands and instead transcribes their exact words into massive, high-contrast text on the screen for the deaf user.

The Universal Exit
To completely reset the state machine and return to the idle home screen, tap the microphone and say:

"Stop"

"Exit"

"Cancel"

"Home"
