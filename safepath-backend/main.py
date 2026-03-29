from fastapi import FastAPI, UploadFile, File
from ultralytics import YOLO
from transformers import pipeline
import io
import numpy as np
import easyocr
import os
import urllib.request
import mediapipe as mp
from mediapipe.tasks import python
from mediapipe.tasks.python import vision
from PIL import Image, ImageOps, ImageEnhance
import whisper
import tempfile
from thefuzz import fuzz
import time
os.environ['GLOG_minloglevel'] = '2'

app = FastAPI()

#intialize YOLOv8
print("Loading YOLO...")
model_yolo = YOLO('yolov8l.pt')
TARGET_CLASSES = [
    0, 1, 2, 3, 5, 7, 10, 11, 13, 24, 25, 56, 57, 58, 59, 60, 61, 62, 63, 67, 73
]

#initialize DepthAnything
print("Loading Depth Anything...")
depth_estimator = pipeline(task="depth-estimation", model="LiheYoung/depth-anything-small-hf")

#easyocr
print("Loading EasyOCR...")
ocr_reader = easyocr.Reader(['en'], gpu=False)

#explain images using BLIP
print("loading BlIP Image Captioner...")
captioner =pipeline("image-text-to-text", model="Salesforce/blip-image-captioning-base")

print("Loading MediaPipe Gesture Recognizer...")
MODEL_PATH = 'gesture_recognizer.task'
if not os.path.exists(MODEL_PATH):
    print("Downloading 3MB gesture model from Google...")
    url = "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task"
    urllib.request.urlretrieve(url, MODEL_PATH)
#initialize MediaPipe
base_options = python.BaseOptions(model_asset_path=MODEL_PATH)
options = vision.GestureRecognizerOptions(base_options=base_options)
recognizer = vision.GestureRecognizer.create_from_options(options)
current_sentence = []
last_detected_gesture = None
last_seen_time = time.time()
sign_hold_streak = 0

#start listening
print("Loading Whisper Voice Engine(Base English)...")
whisper_model = whisper.load_model("base.en")
#global counter to track incoming frames
request_counter = 0

@app.get("/")
def read_root():
    return {"status": "SafePath AI Backend is running"}

#navigation assistent
@app.post("/analyze")
@app.post("/analyze")
async def analyze_image(file: UploadFile = File(...)):
    try:
        contents = await file.read()
        raw_image = Image.open(io.BytesIO(contents))
        
        # FIX 1: Lock the orientation so the math grids align perfectly with reality
        image = ImageOps.exif_transpose(raw_image).convert("RGB")
        
        # Shrink for blazing fast processing
        image.thumbnail((512, 512), Image.Resampling.LANCZOS)

        # 1. DEPTH-FIRST: The Ultimate Safety Net
        depth_result = depth_estimator(image)
        depth_array = np.array(depth_result["depth"])
        
        # FIX 2: Use the exact mathematical shape of the generated depth map
        # (Sometimes depth models return slightly off-by-one pixel dimensions)
        d_height, d_width = depth_array.shape

        # We focus on the bottom 70% of the screen
        danger_zone = depth_array[int(d_height * 0.3):d_height, :]
        
        left_zone = danger_zone[:, :int(d_width * 0.33)]
        center_zone = danger_zone[:, int(d_width * 0.33):int(d_width * 0.66)]
        right_zone = danger_zone[:, int(d_width * 0.66):]

        PROXIMITY_THRESHOLD = 150 
        blocked_zones = {}
        
        # FIX 3: The ".size > 0" Shield. 
        # Prevents math crashes if an array slice accidentally turns up empty.
        if left_zone.size > 0 and np.percentile(left_zone, 95) > PROXIMITY_THRESHOLD: 
            blocked_zones["left"] = "obstacle"
        if center_zone.size > 0 and np.percentile(center_zone, 95) > PROXIMITY_THRESHOLD: 
            blocked_zones["center"] = "obstacle"
        if right_zone.size > 0 and np.percentile(right_zone, 95) > PROXIMITY_THRESHOLD: 
            blocked_zones["right"] = "obstacle"

        # 2. YOLO CONTEXT
        results = model_yolo(image, conf=0.35, imgsz=416)
        
        for result in results:
            for box in result.boxes:
                class_name = model_yolo.names[int(box.cls[0])]
                x1, y1, x2, y2 = map(int, box.xyxy[0].tolist())
                x_center = (x1 + x2) / 2
                
                # FIX 4: Clamp the YOLO boxes so they never bleed outside the screen
                x1, y1 = max(0, x1), max(0, y1)
                x2, y2 = min(d_width, x2), min(d_height, y2)
                
                object_depth_crop = depth_array[y1:y2, x1:x2]
                
                # Double-checking size here as well!
                if object_depth_crop.size > 0 and np.percentile(object_depth_crop, 85) > (PROXIMITY_THRESHOLD - 10):
                    if x_center < (d_width * 0.33) and "left" in blocked_zones:
                        blocked_zones["left"] = class_name
                    elif x_center > (d_width * 0.66) and "right" in blocked_zones:
                        blocked_zones["right"] = class_name
                    elif "center" in blocked_zones:
                        blocked_zones["center"] = class_name

        # 3. SMART SPEECH ROUTER
        if not blocked_zones:
            message = "Path clear."
        else:
            warnings = []
            if "center" in blocked_zones:
                warnings.append(f"{blocked_zones['center']} dead ahead")
            if "left" in blocked_zones:
                warnings.append(f"{blocked_zones['left']} on the left")
            if "right" in blocked_zones:
                warnings.append(f"{blocked_zones['right']} on the right")
            
            if "center" in blocked_zones:
                message = f"Stop. {', '.join(warnings)}."
            else:
                message = f"Careful. {', '.join(warnings)}."
        
        return {"status":"success", "message": message, "model_used": "GRID_FUSION"}

    except Exception as e:
        print(f"CRASH ERROR in Analyze: {str(e)}")
        return {"status": "error", "message": str(e)}
#on demand reading
@app.post("/read_text")
async def read_text(file: UploadFile = File(...)):
    print("--- RUNNING OCR ---")
    try:
        contents = await file.read()
        raw_image = Image.open(io.BytesIO(contents))
        
        # 1. Fix mobile rotation
        oriented_image = ImageOps.exif_transpose(raw_image)
        
        max_width = 1024
        if oriented_image.width > max_width:
            ratio = max_width / oriented_image.width
            new_height = int(oriented_image.height * ratio)
            # LANCZOS is a high-quality downsampling algorithm that prevents text from blurring
            oriented_image = oriented_image.resize((max_width, new_height), Image.Resampling.LANCZOS)
        
        gray_image = oriented_image.convert('L')
        
        contrast_enhancer = ImageEnhance.Contrast(gray_image)
        high_contrast = contrast_enhancer.enhance(2.0)
        
        sharpness_enhancer = ImageEnhance.Sharpness(high_contrast)
        ultra_sharp_image = sharpness_enhancer.enhance(2.0)
        
        # Convert back to RGB array for EasyOCR
        final_image = ultra_sharp_image.convert("RGB")
        image_np = np.array(final_image)
        
        # 4. Read text
        text_results = ocr_reader.readtext(image_np, detail=1)
        
        valid_text = []
        for item in text_results:
            text = item[1]
            confidence = item[2]
            
            # Because the image is now incredibly crisp, we can trust the AI slightly more
            if confidence > 0.40:
                cleaned_text = text.strip()
                if len(cleaned_text) > 1 or cleaned_text.lower() in ['a', 'i']:
                    valid_text.append(cleaned_text)
        
        if not valid_text:
            message = "No clear text detected."
        else:
            full_text = " ".join(valid_text)
            message = f"Text detected: {full_text}"
            
        return {"status": "success", "message": message, "model_used": "OCR"}
        
    except Exception as e:
        print(f"CRASH ERROR in OCR: {str(e)}")
        return {"status": "error", "message": str(e)}
# --- TRACK 3: SCENE DESCRIPTION (HIGH SPEED & BEAM SEARCH) ---
@app.post("/describe_scene")
async def describe_scene(file: UploadFile = File(...)):

    print("--Running Blip Scene Description ---")

    try:

        contents = await file.read()

        image = Image.open(io.BytesIO(contents)).convert("RGB")



        #run bli and ensure new tokens limited to 50

        result = captioner(image, text="a photo of", max_new_tokens=50)



        #extract the text string

        caption  = result[0]['generated_text']



        #make the output conversational

        message = f"In front of you, I see {caption}."



        return {"status": "success", "message": message, "model_used": "BLIP"}



    except Exception as e:

        print(f"CRASH ERROR in BLIP: {str(e)}")

        return {"status": "error", "message": str(e)}

# 1. THE VOCABULARY MAP: Translate robotic labels to human words
GESTURE_VOCABULARY = {
    "Thumb_Up": "Good",
    "Thumb_Down": "Bad",
    "ILoveYou": "I love you",
    "Open_Palm": "Wait",
    "Closed_Fist": "Yes",
    "Pointing_Up": "Look",
    "Victory": "Peace"
}

def build_smart_sentence(words_array):
    raw_string = " ".join(words_array)
    replacements = {
        "Good I love you": "I love you very much",
        "Bad Yes": "I strongly disagree",
        "Wait Peace": "Stop and be peaceful"
    }
    final_string = raw_string
    for combo, replacement in replacements.items():
        final_string = final_string.replace(combo, replacement)
    return final_string + "." if final_string else ""

# --- 4. THE ENDPOINT ---
# --- 4. THE ENDPOINT ---
@app.post("/translate_sign")
async def translate_sign(file: UploadFile = File(...)):
    global current_sentence, last_detected_gesture, last_seen_time
    
    print("--- RUNNING GESTURE RECOGNITION ---")
    
    try:
        contents = await file.read()
        raw_image = Image.open(io.BytesIO(contents))

        oriented_image = ImageOps.exif_transpose(raw_image).convert("RGB")
        oriented_image.thumbnail((512, 512), Image.Resampling.LANCZOS)
        
        image_np = np.array(oriented_image)
        mp_image = mp.Image(image_format=mp.ImageFormat.SRGB, data=image_np)
        
        recognition_result = recognizer.recognize(mp_image)

        # THE FIX: Extended memory from 4 seconds to 15 seconds!
        # This gives you plenty of time to drop your hand and prepare the next sign
        # without Nova deleting the sentence.
        current_time = time.time()
        if current_time - last_seen_time > 15.0:
            current_sentence = []
            last_detected_gesture = None

        if recognition_result.gestures:
            # We only reset the countdown clock if we physically see a hand in the frame
            last_seen_time = current_time 

            top_gesture = recognition_result.gestures[0][0].category_name

            if top_gesture == "None" or top_gesture == "":
                smart_phrase = build_smart_sentence(current_sentence)
                message = f"Sentence: {smart_phrase}" if current_sentence else "Hand detected, but the sign is not recognized."
            else:
                human_word = GESTURE_VOCABULARY.get(top_gesture, top_gesture.replace("_", " "))

                # INSTANT ADD: If the word is different from the last sign, add it immediately
                if human_word != last_detected_gesture:
                    current_sentence.append(human_word)
                    last_detected_gesture = human_word

                smart_phrase = build_smart_sentence(current_sentence)
                message = f"Sentence: {smart_phrase}"
        else:
            smart_phrase = build_smart_sentence(current_sentence)
            message = f"Sentence: {smart_phrase}" if current_sentence else "No hands detected in frame."

        return {"status": "success", "message": message, "model_used": "MEDIAPIPE_SENTENCE"}

    except Exception as e:
        print(f"CRASH ERROR in Gesture: {str(e)}")
        return {"status": "error", "message": str(e)}
@app.post("/listen")
async def listen_to_command(file: UploadFile = File(...)):
    print("--- RUNNING WHISPER TRANSCRIPTION ---")
    
    with tempfile.NamedTemporaryFile(delete=False, suffix=".m4a") as temp_audio:
        temp_audio.write(await file.read())
        temp_audio_path = temp_audio.name

    try:
        # 1. THE WHISPER CHEAT CODE: Prime the AI for South African accents and our specific vocabulary
        # This forces Whisper to heavily favor these exact words if the audio is slightly ambiguous.
        priming_prompt = "Hello Nova. I am speaking with a South African accent. Please navigate, read text, describe scene, or translate sign."
        
        result = whisper_model.transcribe(
            temp_audio_path, 
            fp16=False,
            initial_prompt=priming_prompt # Injecting the prompt here!
        )
        
        spoken_text = result["text"].strip()
        text_lower = spoken_text.lower()
        
        print(f"Whisper heard: '{text_lower}'")
        
        if not text_lower:
             return {"status": "error", "message": "I didn't hear any clear words."}

        # 2. THE SYNONYM NET: Map out exact commands, common synonyms, and phonetic mistakes
        command_mappings = {
            "read_text": ["read", "text", "red text", "read this", "words"],
            "describe_scene": ["describe", "scene", "look around", "what is this", "seen", "describe seen", "environment"],
            "translate_sign": ["sign", "translate", "language", "interpreter", "hand", "gestures"],
            "toggle_nav": ["navigate", "start", "stop", "walk", "assist", "navvy", "navigation", "go"]
        }

        action = "unknown"
        highest_score = 0
        
        # 3. ADVANCED FUZZY ROUTER: Check the spoken text against every possible synonym
        for target_action, keywords in command_mappings.items():
            for word in keywords:
                # We use token_set_ratio which is much smarter for comparing short commands inside long sentences
                score = fuzz.token_set_ratio(word, text_lower)
                
                if score > highest_score:
                    highest_score = score
                    # If we find a match that is at least 70% confident, lock it in as the top choice
                    if highest_score > 70:
                        action = target_action

        return {"status": "success", "text": spoken_text, "action": action}
        
    except Exception as e:
        print(f"CRASH ERROR in Whisper: {str(e)}")
        return {"status": "error", "message": "Audio processing failed."}
        
    finally:
        if os.path.exists(temp_audio_path):
            os.remove(temp_audio_path)
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)