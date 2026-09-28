import json
import time
import math
import sqlite3
import threading
import asyncio
import os
import cv2
import paho.mqtt.client as mqtt
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import JSONResponse, FileResponse, StreamingResponse
from ultralytics import YOLO
import uvicorn
import numpy as np

# ================= 1. FASTAPI SETUP =================
app = FastAPI(
    title="Smart Belt AI - Industrial Conveyor Predictive Maintenance & 3D Digital Twin",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], 
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ================= 2. MULTI-LEVEL DAMAGE TAXONOMY & NFC REGISTRY =================
DAMAGE_CLASSES = {
    "NORMAL_BELT": {
        "name": "Normal Belt (Grade A)",
        "category": "BASELINE",
        "severity": 0,
        "is_early_warning": False,
        "rul_nominal_hours": 1200.0,
        "action": "Normal operation. Routine inspection scheduled."
    },
    "SMALL_CRACKS": {
        "name": "Small Cracks (Micro-Fissures)",
        "category": "EARLY_WARNING",
        "severity": 25,
        "is_early_warning": True,
        "rul_nominal_hours": 480.0,
        "action": "Early Warning: Surface micro-cracks detected. Apply rubber elastomer conditioner during next shift."
    },
    "FRAYING": {
        "name": "Surface / Cord Fraying",
        "category": "EARLY_WARNING",
        "severity": 30,
        "is_early_warning": True,
        "rul_nominal_hours": 360.0,
        "action": "Early Warning: Fiber fraying detected. Inspect chute skirt seals and clear debris."
    },
    "EDGE_WEAR": {
        "name": "Edge Wear & Scalloping",
        "category": "EARLY_WARNING",
        "severity": 35,
        "is_early_warning": True,
        "rul_nominal_hours": 290.0,
        "action": "Early Warning: Edge erosion detected. Re-align side guide idlers to stop lateral chafing."
    },
    "SURFACE_DEFORMATION": {
        "name": "Surface Deformation & Blistering",
        "category": "EARLY_WARNING",
        "severity": 40,
        "is_early_warning": True,
        "rul_nominal_hours": 220.0,
        "action": "Early Warning: Gauge depression / impact blister. Check loading chute damper beds."
    },
    "ABNORMAL_MOVEMENT": {
        "name": "Abnormal Belt Movement / Slip",
        "category": "EARLY_WARNING",
        "severity": 45,
        "is_early_warning": True,
        "rul_nominal_hours": 180.0,
        "action": "Early Warning: Tachometer slip ratio exceeds 4.5%. Clean drive drum lagging; inspect gravity take-up."
    },
    "SMALL_TEAR": {
        "name": "Small Tear / Hairline Breach",
        "category": "INCIPIENT_DEFECT",
        "severity": 55,
        "is_early_warning": False,
        "rul_nominal_hours": 96.0,
        "action": "Minor Defect: Splice hairline tear. Schedule cold vulcanization patch within 48 hours."
    },
    "HOLE_PUNCTURE": {
        "name": "Hole / Puncture Gouge",
        "category": "LOCAL_DAMAGE",
        "severity": 65,
        "is_early_warning": False,
        "rul_nominal_hours": 48.0,
        "action": "Moderate Damage: Through-puncture detected. Remove trapped tramp metal from transfer chute."
    },
    "TRANSVERSE_TEAR": {
        "name": "Transverse Tear (Cross-Splice)",
        "category": "CRITICAL_SPLICE",
        "severity": 78,
        "is_early_warning": False,
        "rul_nominal_hours": 18.0,
        "action": "Critical Threat: Cross-belt tear at splice. Reduce belt velocity to 50%; hot vulcanizing crew dispatched."
    },
    "LONGITUDINAL_RUPTURE": {
        "name": "Longitudinal Rupture (Lengthwise Slit)",
        "category": "CRITICAL_RUPTURE",
        "severity": 90,
        "is_early_warning": False,
        "rul_nominal_hours": 2.0,
        "action": "Critical Hazard: Lengthwise rip in progress! Automated Rip-Stop interlock engaged."
    },
    "BELT_MISALIGNMENT": {
        "name": "Severe Belt Misalignment (>25mm)",
        "category": "TRACKING_FAULT",
        "severity": 70,
        "is_early_warning": False,
        "rul_nominal_hours": 24.0,
        "action": "Tracking Alarm: Belt tracking offset >25mm. Trigger automated training idlers and slow drive."
    },
    "SEVERE_RUPTURE": {
        "name": "Severe Rupture / Carcass Separation",
        "category": "CATASTROPHIC",
        "severity": 100,
        "is_early_warning": False,
        "rul_nominal_hours": 0.0,
        "action": "CATASTROPHIC TRIP: Complete carcass failure! Emergency drive interlock opened. Lockout/Tagout initiated."
    }
}

# NFC Splice Joint Registry (conveyor perimeter = 120 meters, 10 vulcanized splices)
NFC_REGISTRY = {
    f"J0{i:02d}": {
        "joint_id": f"J0{i:02d}",
        "nfc_tag_id": f"NFC-ISO15693-{4100 + i:04d}",
        "chainage_m": round(i * 12.0, 1),
        "zone": f"Zone {((i-1)//3) + 1}: " + ("Carrying Run - Loading Chute" if i <= 3 else "Carrying Run - Center Truss" if i <= 6 else "Return Run - Take-Up Terminal"),
        "gps_coords": f"23°24'{40 + (i*1.8):.1f}\"N, 85°20'{10 + (i*2.1):.1f}\"E",
        "substation_bay": f"Substation B - Bay {i}",
        "splice_type": "Finger Splice - Steel Cord ST-2500" if i % 2 == 0 else "Step Splice - Fabric EP-400",
        "installed_date": f"2025-{(i%12)+1:02d}-15",
        "inspection_count": 140 + i * 8,
    }
    for i in range(1, 11)
}

# ================= 3. DATABASE SETUP (SQLite) =================
def init_db():
    conn = sqlite3.connect('smart_belt.db')
    c = conn.cursor()
    c.execute('''CREATE TABLE IF NOT EXISTS joint_logs 
                 (timestamp TEXT, joint_id TEXT, temp REAL, vibration REAL, 
                  speed REAL, alignment TEXT, sound INT, tension REAL, 
                  yolo_damage INT, health_score REAL, status TEXT)''')
    
    # Try adding new predictive columns if table already existed
    for col, col_type in [
        ("damage_type", "TEXT"),
        ("nfc_tag_id", "TEXT"),
        ("chainage_m", "REAL"),
        ("rul_hours", "REAL"),
        ("failure_prob_24h", "REAL")
    ]:
        try:
            c.execute(f"ALTER TABLE joint_logs ADD COLUMN {col} {col_type}")
        except sqlite3.OperationalError:
            pass  # Already exists
            
    conn.commit()
    conn.close()

init_db()

# ================= 4. LIVE SYSTEM STATE =================
LIVE_DATA = {
    "demo_mode": True,
    "conveyor_status": "RUNNING",
    "joint_id": "J001",
    "nfc_tag_id": "NFC-J001",
    "chainage_m": NFC_REGISTRY["J001"]["chainage_m"],
    "zone": NFC_REGISTRY["J001"]["zone"],
    "gps_coords": NFC_REGISTRY["J001"]["gps_coords"],
    "substation_bay": NFC_REGISTRY["J001"]["substation_bay"],
    "damage_type": "NORMAL_BELT",
    "damage_class_name": DAMAGE_CLASSES["NORMAL_BELT"]["name"],
    "damage_category": DAMAGE_CLASSES["NORMAL_BELT"]["category"],
    "damage_severity": 0.0,
    "is_early_warning": False,
    "temperature": 42.5,
    "vibration": 1.10,
    "speed": 2.50,
    "alignment": "CENTERED",
    "alignment_offset_mm": 0.0,
    "sound": 55,
    "tension": 5.0,
    "yolo_damage": False,
    "yolo_confidence": 0.98,
    "yolo_box": None,
    "health_score": 94.0,
    "rul_hours": 1200.0,
    "failure_probability_24h": 0.5,
    "failure_probability_7d": 2.1,
    "failure_probability_30d": 8.4,
    "status": "NORMAL",
    "early_warning_message": "All sensor telemetry nominal. Real-time optical and vibration monitoring active.",
    "prescriptive_action": "System operating optimally. Continuous acoustic and vibration monitoring active.",
    "total_inspections": 184,
    "warning_count": 0,
    "critical_count": 0,
    "safety_light": "GREEN"
}

# ================= 5. YOLO & VISION SETUP =================
yolo_model = None
try:
    if os.path.exists("yolov8n.pt"):
        yolo_model = YOLO("yolov8n.pt")
        print("✅ YOLOv8 Model loaded successfully")
except Exception as e:
    print(f"⚠️ YOLO model loading deferred: {e}")

cap = None
camera_enabled = True
latest_frame_bytes = None
frame_lock = threading.Lock()
conveyor_sim_offset = 0

cam_fail_count = 0

def get_webcam():
    global cap
    if not camera_enabled:
        return None
    if cap is None:
        try:
            cap = cv2.VideoCapture(0)
            if not cap.isOpened():
                cap = None
            else:
                cap.set(cv2.CAP_PROP_FRAME_WIDTH, 640)
                cap.set(cv2.CAP_PROP_FRAME_HEIGHT, 360)
        except Exception as e:
            print(f"Hardware camera open notice: {e}")
            cap = None
    return cap

def release_webcam():
    global cap, camera_enabled
    camera_enabled = False
    if cap is not None:
        try:
            cap.release()
        except Exception:
            pass
        cap = None

def reclaim_webcam():
    global camera_enabled, cam_fail_count
    camera_enabled = True
    cam_fail_count = 0

def generate_synthetic_conveyor_frame():
    global conveyor_sim_offset
    h, w = 360, 640
    frame = np.full((h, w, 3), (25, 20, 15), dtype=np.uint8) # Dark industrial navy
    
    # Conveyor belt surface (middle strip)
    belt_top, belt_bottom = 80, 280
    frame[belt_top:belt_bottom, :] = (40, 42, 45) # Dark rubber
    
    # Moving rubber grain / texture lines
    if LIVE_DATA.get("conveyor_status") == "RUNNING":
        conveyor_sim_offset = (conveyor_sim_offset + 6) % w
    for x in range(0, w, 40):
        xx = (x + conveyor_sim_offset) % w
        cv2.line(frame, (xx, belt_top), (xx, belt_bottom), (50, 52, 56), 1)
        
    # Belt steel guide rails
    cv2.rectangle(frame, (0, belt_top - 12), (w, belt_top), (80, 85, 95), -1)
    cv2.rectangle(frame, (0, belt_bottom), (w, belt_bottom + 12), (80, 85, 95), -1)
    
    # Passing Vulcanized Splice Joint
    joint_x = (conveyor_sim_offset * 2) % w
    joint_id = LIVE_DATA.get("joint_id", "J001")
    cv2.line(frame, (joint_x, belt_top), (joint_x + 18, belt_bottom), (0, 200, 255), 3) # Golden splice
    cv2.putText(frame, f"SPLICE {joint_id}", (max(10, joint_x - 30), belt_top - 18), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 220, 255), 1)
    
    # Laser Scan Fan Line (Center of camera view)
    laser_color = (0, 0, 255) if LIVE_DATA.get("damage_type") != "NORMAL_BELT" else (0, 255, 100)
    cv2.line(frame, (w // 2, belt_top), (w // 2, belt_bottom), laser_color, 2)
    
    # If Defect is simulated: Draw the flaw near the splice!
    dmg = LIVE_DATA.get("damage_type", "NORMAL_BELT")
    if dmg != "NORMAL_BELT":
        cx, cy = joint_x + 8, (belt_top + belt_bottom) // 2
        if dmg in ["TRANSVERSE_TEAR", "SEVERE_RUPTURE"]:
            cv2.line(frame, (cx - 25, cy - 35), (cx + 25, cy + 35), (0, 0, 255), 4)
            cv2.line(frame, (cx - 15, cy + 10), (cx + 30, cy - 20), (0, 0, 255), 3)
            # YOLO Bounding Box
            cv2.rectangle(frame, (cx - 45, cy - 50), (cx + 45, cy + 50), (0, 0, 255), 2)
            cv2.putText(frame, "AI: JOINT RUPTURE 98.4%", (cx - 45, max(20, cy - 56)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 2)
        elif dmg == "LONGITUDINAL_RUPTURE":
            cv2.line(frame, (cx - 60, cy), (cx + 60, cy), (0, 0, 255), 4)
            cv2.rectangle(frame, (cx - 70, cy - 20), (cx + 70, cy + 20), (0, 0, 255), 2)
            cv2.putText(frame, "AI: LONGITUDINAL RIP 96.1%", (cx - 70, max(20, cy - 26)), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (0, 0, 255), 2)
        else:
            cv2.circle(frame, (cx, cy), 14, (0, 165, 255), 2)
            cv2.putText(frame, f"AI: {dmg.replace('_', ' ')} 89.2%", (cx - 40, max(20, cy - 22)), cv2.FONT_HERSHEY_SIMPLEX, 0.4, (0, 165, 255), 1)

    # Industrial HUD Telemetry Overlay
    cv2.putText(frame, "SMART-BELT AI VISION | CAMERA STATION 01", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)
    status_str = f"BELT: {LIVE_DATA.get('conveyor_status', 'RUNNING')} ({LIVE_DATA.get('speed', 2.5):.2f} m/s) | JOINT: {joint_id}"
    cv2.putText(frame, status_str, (15, h - 15), cv2.FONT_HERSHEY_SIMPLEX, 0.45, (200, 200, 200), 1)
    
    return frame

# ================= 6. SENSOR FUSION & PREDICTIVE MAINTENANCE LOGIC =================
def compute_predictive_metrics(damage_type: str, vib: float, temp: float, sound: float, tension: float, align_offset: float):
    dmg = DAMAGE_CLASSES.get(damage_type, DAMAGE_CLASSES["NORMAL_BELT"])
    
    # 1. Base Health Deduction
    base_deduction = dmg["severity"] * 0.65
    
    # 2. Vibration factor (bearing and splice shock)
    vib_deduction = 0.0
    if vib > 2.5:
        vib_deduction = 28.0
    elif vib > 1.2:
        vib_deduction = 14.0
    elif vib > 0.7:
        vib_deduction = 6.0
        
    # 3. Temperature factor (friction & bearing heat)
    temp_deduction = 0.0
    if temp > 65.0:
        temp_deduction = 22.0
    elif temp > 50.0:
        temp_deduction = 10.0
    elif temp > 42.0:
        temp_deduction = 4.0
        
    # 4. Sound factor (chafing, slapping, bearing rattle)
    sound_deduction = 0.0
    if sound > 85:
        sound_deduction = 12.0
    elif sound > 72:
        sound_deduction = 6.0
        
    # 5. Tension deviation
    tension_deduction = 0.0
    if tension < 2.5 or tension > 8.5:
        tension_deduction = 15.0
    elif tension < 3.8 or tension > 6.8:
        tension_deduction = 7.0
        
    # 6. Alignment offset
    align_deduction = min(20.0, abs(align_offset) * 0.8)
    
    # Total Health Score
    total_deduction = base_deduction + vib_deduction + temp_deduction + sound_deduction + tension_deduction + align_deduction
    health_score = max(0.0, min(100.0, 100.0 - total_deduction))
    
    # Status Risk Level
    if health_score < 45.0 or dmg["severity"] >= 75:
        status = "CRITICAL"
    elif health_score < 75.0 or dmg["is_early_warning"]:
        status = "WARNING"
    else:
        status = "NORMAL"
        
    # Remaining Useful Life (RUL) Modeling via non-linear structural fatigue equation
    fatigue_ratio = (100.0 - health_score) / 100.0
    rul_hours = max(0.0, dmg["rul_nominal_hours"] * (1.0 - math.pow(fatigue_ratio, 1.4)))
    
    # Failure Probabilities
    if status == "CRITICAL":
        prob_24h = min(99.0, 65.0 + (100.0 - health_score) * 0.35)
        prob_7d = min(99.9, 90.0 + (100.0 - health_score) * 0.1)
        prob_30d = 100.0
    elif status == "WARNING":
        prob_24h = min(40.0, 5.0 + fatigue_ratio * 35.0)
        prob_7d = min(75.0, 15.0 + fatigue_ratio * 60.0)
        prob_30d = min(95.0, 35.0 + fatigue_ratio * 60.0)
    else:
        prob_24h = 0.5
        prob_7d = 2.4
        prob_30d = 8.5
        
    return {
        "health_score": round(health_score, 1),
        "status": status,
        "rul_hours": round(rul_hours, 1),
        "failure_prob_24h": round(prob_24h, 1),
        "failure_prob_7d": round(prob_7d, 1),
        "failure_prob_30d": round(prob_30d, 1),
        "action": dmg["action"]
    }

def update_live_health():
    res = compute_predictive_metrics(
        LIVE_DATA["damage_type"],
        LIVE_DATA["vibration"],
        LIVE_DATA["temperature"],
        LIVE_DATA["sound"],
        LIVE_DATA["tension"],
        LIVE_DATA["alignment_offset_mm"]
    )
    LIVE_DATA["health_score"] = res["health_score"]
    LIVE_DATA["status"] = res["status"]
    LIVE_DATA["rul_hours"] = res["rul_hours"]
    LIVE_DATA["failure_probability_24h"] = res["failure_prob_24h"]
    LIVE_DATA["failure_probability_7d"] = res["failure_prob_7d"]
    LIVE_DATA["failure_probability_30d"] = res["failure_prob_30d"]
    LIVE_DATA["prescriptive_action"] = res["action"]
    
    dmg = DAMAGE_CLASSES.get(LIVE_DATA["damage_type"], DAMAGE_CLASSES["NORMAL_BELT"])
    LIVE_DATA["damage_class_name"] = dmg["name"]
    LIVE_DATA["damage_category"] = dmg["category"]
    LIVE_DATA["damage_severity"] = dmg["severity"]
    LIVE_DATA["is_early_warning"] = dmg["is_early_warning"]
    
    if dmg["is_early_warning"] or res["status"] == "WARNING":
        LIVE_DATA["safety_light"] = "AMBER"
        LIVE_DATA["early_warning_message"] = f"PREDICTIVE ALERT: {dmg['name']} flagged by multi-sensor fusion. RUL projected at {res['rul_hours']}h."
    elif res["status"] == "CRITICAL":
        LIVE_DATA["safety_light"] = "RED"
        LIVE_DATA["early_warning_message"] = f"CRITICAL INTERLOCK TRIP: {dmg['name']} detected. Conveyor safety interlock triggered."
    else:
        LIVE_DATA["safety_light"] = "GREEN"
        LIVE_DATA["early_warning_message"] = "Belt splice and carcass operating within normal parameters."

def save_to_database():
    try:
        conn = sqlite3.connect('smart_belt.db')
        c = conn.cursor()
        c.execute('''INSERT INTO joint_logs 
                     (timestamp, joint_id, temp, vibration, speed, alignment, sound, tension, yolo_damage, health_score, status, damage_type, nfc_tag_id, chainage_m, rul_hours, failure_prob_24h)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)''',
                  (time.strftime('%Y-%m-%d %H:%M:%S'), LIVE_DATA["joint_id"], 
                   LIVE_DATA["temperature"], LIVE_DATA["vibration"], LIVE_DATA["speed"],
                   LIVE_DATA["alignment"], LIVE_DATA["sound"], LIVE_DATA["tension"],
                   1 if LIVE_DATA["yolo_damage"] else 0, LIVE_DATA["health_score"], LIVE_DATA["status"],
                   LIVE_DATA["damage_type"], LIVE_DATA["nfc_tag_id"], LIVE_DATA["chainage_m"],
                   LIVE_DATA["rul_hours"], LIVE_DATA["failure_probability_24h"]))
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"Database save error: {e}")

# ================= 7. BACKGROUND TELEMETRY & SIMULATION =================
def run_vision_and_mqtt():
    def on_connect(client, userdata, flags, rc):
        print("✅ Connected to MQTT Broker")
        try:
            client.subscribe("conveyor/sensors")
        except Exception:
            pass

    def on_message(client, userdata, msg):
        try:
            if LIVE_DATA.get("demo_mode", True):
                # In DEMO MODE, hardware MQTT sensor messages are strictly IGNORED
                return
            payload = json.loads(msg.payload.decode())
            for k in ["joint_id", "temperature", "vibration", "speed", "alignment", "sound", "tension"]:
                if k in payload:
                    LIVE_DATA[k] = payload[k]
            update_live_health()
            save_to_database()
        except Exception as e:
            print(f"MQTT Error: {e}")

    try:
        mqtt_client = mqtt.Client()
        mqtt_client.on_connect = on_connect
        mqtt_client.on_message = on_message
        mqtt_client.connect("broker.hivemq.com", 1883, 60)
        mqtt_client.loop_start()
    except Exception as e:
        print(f"MQTT start info (offline mode active): {e}")

    # Vision loop
    frame_counter = 0
    cached_boxes = []

    global cam_fail_count
    cam_fail_count = 0

    while True:
        cam = get_webcam()
        frame = None
        
        if cam is not None and cam.isOpened():
            try:
                ret, captured = cam.read()
                if ret and captured is not None:
                    frame = captured
                    cam_fail_count = 0
                else:
                    cam_fail_count += 1
                    if cam_fail_count >= 3:
                        # Hardware camera cannot grab frames (e.g. privacy shutter closed or blocked by OS)
                        # Release to avoid flooding MSMF errors and fallback to synthetic visual stream
                        release_webcam()
            except Exception:
                release_webcam()
        
        if frame is None:
            # Generate synthetic conveyor visual scan when camera is released or unavailable
            frame = generate_synthetic_conveyor_frame()
        else:
            # Process real webcam frame with YOLO
            frame_counter += 1
            if yolo_model is not None and frame_counter % 2 == 0:
                try:
                    results = yolo_model(frame, verbose=False)
                    new_boxes = []
                    damage_detected = False
                    for r in results:
                        for box in r.boxes:
                            x1, y1, x2, y2 = map(int, box.xyxy[0])
                            cls_id = int(box.cls[0])
                            cls_name = yolo_model.names.get(cls_id, "defect")
                            conf = float(box.conf[0])
                            is_defect = cls_name in ['person', 'damage', 'bottle', 'crack', 'cell phone']
                            if is_defect:
                                damage_detected = True
                            new_boxes.append((x1, y1, x2, y2, cls_name, conf, is_defect))
                    cached_boxes = new_boxes
                    LIVE_DATA["yolo_damage"] = damage_detected
                    if damage_detected and LIVE_DATA["damage_type"] == "NORMAL_BELT":
                        LIVE_DATA["damage_type"] = "SMALL_CRACKS"
                        update_live_health()
                except Exception:
                    pass
            
            # Draw bounding boxes
            for (x1, y1, x2, y2, cls_name, conf, is_defect) in cached_boxes:
                col = (0, 0, 255) if is_defect else (0, 255, 0)
                cv2.rectangle(frame, (x1, y1), (x2, y2), col, 2)
                tag_label = "DAMAGE / CRACK" if is_defect else cls_name.upper()
                cv2.putText(frame, f"{tag_label} {conf:.2f}", (x1, max(20, y1 - 8)), cv2.FONT_HERSHEY_SIMPLEX, 0.5, col, 2)
                
            # Laser line overlay
            h, w = frame.shape[:2]
            laser_color = (0, 0, 255) if LIVE_DATA.get("damage_type") != "NORMAL_BELT" else (0, 255, 100)
            cv2.line(frame, (w // 2, 0), (w // 2, h), laser_color, 2)
            cv2.putText(frame, f"OPTICAL LASER SCANNER | JOINT: {LIVE_DATA.get('joint_id', 'J001')}", (15, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 2)
            
        # Encode to JPEG for MJPEG stream
        try:
            _, buffer = cv2.imencode('.jpg', frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            with frame_lock:
                latest_frame_bytes = buffer.tobytes()
        except Exception:
            pass
            
        time.sleep(0.04)

async def generate_mjpeg_stream():
    while True:
        with frame_lock:
            frame_data = latest_frame_bytes
        if frame_data is None:
            # Immediate synthetic fallback to prevent stream client timeout
            syn_frame = generate_synthetic_conveyor_frame()
            _, buf = cv2.imencode('.jpg', syn_frame, [int(cv2.IMWRITE_JPEG_QUALITY), 75])
            frame_data = buf.tobytes()
        
        yield (b'--frame\r\n'
               b'Content-Type: image/jpeg\r\n\r\n' + frame_data + b'\r\n')
        await asyncio.sleep(0.04)

# ================= 8. API ENDPOINTS =================
@app.get("/api/video_feed")
async def video_feed():
    return StreamingResponse(generate_mjpeg_stream(), media_type="multipart/x-mixed-replace; boundary=frame")

@app.post("/api/camera/release")
def api_release_camera():
    release_webcam()
    return {"status": "ok", "message": "Backend webcam released for browser direct access."}

@app.post("/api/camera/reclaim")
def api_reclaim_camera():
    reclaim_webcam()
    return {"status": "ok", "message": "Backend webcam reclaimed for AI server inference."}

@app.get("/api/camera/status")
def api_camera_status():
    global cap
    is_open = cap is not None and cap.isOpened()
    return {
        "camera_enabled": camera_enabled,
        "is_opened": is_open,
        "yolo_active": yolo_model is not None,
        "current_damage": LIVE_DATA.get("damage_type", "NORMAL_BELT")
    }
@app.get("/api/sensors")
def get_sensors():
    return [LIVE_DATA]

@app.get("/api/live")
def get_live_data():
    return LIVE_DATA

@app.post("/api/predict")
def predict(data: dict):
    vibration = float(data.get("vibration", LIVE_DATA["vibration"]))
    temperature = float(data.get("temperature", LIVE_DATA["temperature"]))
    sound = float(data.get("sound_level", data.get("sound", LIVE_DATA["sound"])))
    tension = float(data.get("tension", LIVE_DATA["tension"]))
    damage_type = data.get("damage_type", LIVE_DATA["damage_type"])
    align_offset = float(data.get("alignment_offset_mm", LIVE_DATA["alignment_offset_mm"]))
    
    metrics = compute_predictive_metrics(damage_type, vibration, temperature, sound, tension, align_offset)
    return {
        "health_score": metrics["health_score"],
        "risk_level": metrics["status"],
        "rul_hours": metrics["rul_hours"],
        "failure_probability_24h": metrics["failure_prob_24h"],
        "failure_probability_7d": metrics["failure_prob_7d"],
        "prescriptive_action": metrics["action"]
    }

@app.get("/api/history")
def get_all_history(joint_id: str = "ALL", risk: str = "ALL"):
    try:
        conn = sqlite3.connect('smart_belt.db')
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        query = "SELECT * FROM joint_logs WHERE 1=1"
        params = []
        if joint_id != "ALL":
            query += " AND joint_id = ?"
            params.append(joint_id)
        if risk != "ALL":
            query += " AND status = ?"
            params.append(risk)
        query += " ORDER BY timestamp DESC LIMIT 50"
        c.execute(query, params)
        rows = [dict(ix) for ix in c.fetchall()]
        conn.close()
        return {"success": True, "data": rows}
    except Exception as e:
        return {"success": False, "error": str(e), "data": []}

@app.get("/api/history/{joint_id}")
def get_joint_history(joint_id: str):
    conn = sqlite3.connect('smart_belt.db')
    conn.row_factory = sqlite3.Row
    c = conn.cursor()
    c.execute("SELECT * FROM joint_logs WHERE joint_id = ? ORDER BY timestamp DESC LIMIT 50", (joint_id,))
    rows = [dict(ix) for ix in c.fetchall()]
    conn.close()
    return {"joint_id": joint_id, "history": rows}

@app.post("/api/demo/mode")
def set_demo_mode(payload: dict):
    enable = payload.get("enable", True)
    LIVE_DATA["demo_mode"] = bool(enable)
    return {"status": "ok", "demo_mode": LIVE_DATA["demo_mode"]}

@app.post("/api/demo/simulate-damage")
def demo_simulate_damage(payload: dict):
    LIVE_DATA["vibration"] = 3.65
    LIVE_DATA["temperature"] = 69.4
    LIVE_DATA["sound"] = 92
    LIVE_DATA["alignment"] = "MISALIGNED"
    LIVE_DATA["tension"] = 2.1
    LIVE_DATA["damage_type"] = "SEVERE_RUPTURE"
    LIVE_DATA["yolo_damage"] = True
    update_live_health()
    return {"status": "ok", "damage_type": "SEVERE_RUPTURE", "live": LIVE_DATA}

@app.post("/api/conveyor/control")
def conveyor_control(payload: dict):
    action = payload.get("action", "").upper()
    if action == "START":
        LIVE_DATA["conveyor_status"] = "RUNNING"
        LIVE_DATA["speed"] = 2.50
    elif action in ["STOP", "PAUSE"]:
        LIVE_DATA["conveyor_status"] = "STOPPED"
        LIVE_DATA["speed"] = 0.0
    elif action == "EMERGENCY_STOP":
        LIVE_DATA["conveyor_status"] = "EMERGENCY_STOP"
        LIVE_DATA["speed"] = 0.0
    elif action == "SET_SPEED":
        LIVE_DATA["speed"] = max(0.0, min(3.5, float(payload.get("speed", 1.85))))
        if LIVE_DATA["speed"] > 0:
            LIVE_DATA["conveyor_status"] = "RUNNING"
        else:
            LIVE_DATA["conveyor_status"] = "STOPPED"
            
    return {"status": "ok", "conveyor_status": LIVE_DATA["conveyor_status"], "speed": LIVE_DATA["speed"]}

@app.post("/api/simulate/fault")
def simulate_fault(payload: dict):
    """
    Allows injecting any multi-level damage or early warning state:
    NORMAL_BELT, SMALL_CRACKS, FRAYING, EDGE_WEAR, SURFACE_DEFORMATION,
    ABNORMAL_MOVEMENT, SMALL_TEAR, HOLE_PUNCTURE, TRANSVERSE_TEAR,
    LONGITUDINAL_RUPTURE, BELT_MISALIGNMENT, SEVERE_RUPTURE
    """
    dtype = payload.get("damage_type", "NORMAL_BELT")
    if dtype not in DAMAGE_CLASSES:
        dtype = "NORMAL_BELT"
        
    LIVE_DATA["damage_type"] = dtype
    dmg = DAMAGE_CLASSES[dtype]
    
    # Adjust physical telemetry to match the selected fault for realistic sensor fusion
    if dtype == "NORMAL_BELT":
        LIVE_DATA["vibration"] = 1.10
        LIVE_DATA["temperature"] = 42.5
        LIVE_DATA["sound"] = 55
        LIVE_DATA["tension"] = 5.2
        LIVE_DATA["speed"] = 2.50
        LIVE_DATA["conveyor_status"] = "RUNNING"
        LIVE_DATA["alignment"] = "CENTERED"
        LIVE_DATA["alignment_offset_mm"] = 0.0
        LIVE_DATA["yolo_damage"] = False
    elif dtype == "SMALL_CRACKS":
        LIVE_DATA["vibration"] = 0.72
        LIVE_DATA["temperature"] = 39.1
        LIVE_DATA["sound"] = 68
        LIVE_DATA["tension"] = 5.1
        LIVE_DATA["alignment_offset_mm"] = 1.2
        LIVE_DATA["yolo_damage"] = True
    elif dtype == "FRAYING":
        LIVE_DATA["vibration"] = 0.85
        LIVE_DATA["temperature"] = 41.5
        LIVE_DATA["sound"] = 74
        LIVE_DATA["tension"] = 4.9
        LIVE_DATA["alignment_offset_mm"] = 2.5
        LIVE_DATA["yolo_damage"] = True
    elif dtype == "EDGE_WEAR":
        LIVE_DATA["vibration"] = 1.15
        LIVE_DATA["temperature"] = 45.2
        LIVE_DATA["sound"] = 79
        LIVE_DATA["tension"] = 4.8
        LIVE_DATA["alignment"] = "DRIFT_LEFT"
        LIVE_DATA["alignment_offset_mm"] = -8.5
        LIVE_DATA["yolo_damage"] = True
    elif dtype == "SURFACE_DEFORMATION":
        LIVE_DATA["vibration"] = 1.45
        LIVE_DATA["temperature"] = 48.0
        LIVE_DATA["sound"] = 76
        LIVE_DATA["tension"] = 4.6
        LIVE_DATA["alignment_offset_mm"] = 3.0
        LIVE_DATA["yolo_damage"] = True
    elif dtype == "ABNORMAL_MOVEMENT":
        LIVE_DATA["vibration"] = 1.65
        LIVE_DATA["temperature"] = 52.0
        LIVE_DATA["sound"] = 81
        LIVE_DATA["tension"] = 3.7
        LIVE_DATA["alignment"] = "WANDERING"
        LIVE_DATA["alignment_offset_mm"] = 14.2
        LIVE_DATA["yolo_damage"] = False
    elif dtype == "SMALL_TEAR":
        LIVE_DATA["vibration"] = 1.85
        LIVE_DATA["temperature"] = 54.3
        LIVE_DATA["sound"] = 84
        LIVE_DATA["tension"] = 4.2
        LIVE_DATA["alignment_offset_mm"] = 4.0
        LIVE_DATA["yolo_damage"] = True
    elif dtype == "HOLE_PUNCTURE":
        LIVE_DATA["vibration"] = 2.10
        LIVE_DATA["temperature"] = 57.0
        LIVE_DATA["sound"] = 86
        LIVE_DATA["tension"] = 4.0
        LIVE_DATA["alignment_offset_mm"] = 5.2
        LIVE_DATA["yolo_damage"] = True
    elif dtype == "TRANSVERSE_TEAR":
        LIVE_DATA["vibration"] = 2.75
        LIVE_DATA["temperature"] = 62.5
        LIVE_DATA["sound"] = 92
        LIVE_DATA["tension"] = 3.2
        LIVE_DATA["alignment_offset_mm"] = 9.0
        LIVE_DATA["yolo_damage"] = True
        LIVE_DATA["conveyor_status"] = "EMERGENCY_STOP"
        LIVE_DATA["speed"] = 0.0
    elif dtype == "LONGITUDINAL_RUPTURE":
        LIVE_DATA["vibration"] = 3.40
        LIVE_DATA["temperature"] = 69.8
        LIVE_DATA["sound"] = 98
        LIVE_DATA["tension"] = 2.1
        LIVE_DATA["alignment"] = "SEVERE_SKEW"
        LIVE_DATA["alignment_offset_mm"] = 18.5
        LIVE_DATA["yolo_damage"] = True
        LIVE_DATA["conveyor_status"] = "EMERGENCY_STOP"
        LIVE_DATA["speed"] = 0.0
    elif dtype == "BELT_MISALIGNMENT":
        LIVE_DATA["vibration"] = 2.20
        LIVE_DATA["temperature"] = 66.4
        LIVE_DATA["sound"] = 89
        LIVE_DATA["tension"] = 5.8
        LIVE_DATA["alignment"] = "MISALIGNED_RIGHT"
        LIVE_DATA["alignment_offset_mm"] = 26.8
        LIVE_DATA["yolo_damage"] = False
    elif dtype == "SEVERE_RUPTURE":
        LIVE_DATA["vibration"] = 4.20
        LIVE_DATA["temperature"] = 76.0
        LIVE_DATA["sound"] = 104
        LIVE_DATA["tension"] = 1.2
        LIVE_DATA["alignment"] = "DISPLACED"
        LIVE_DATA["alignment_offset_mm"] = 35.0
        LIVE_DATA["yolo_damage"] = True
        LIVE_DATA["conveyor_status"] = "EMERGENCY_STOP"
        LIVE_DATA["speed"] = 0.0
        
    update_live_health()
    save_to_database()
    return {"status": "ok", "damage_type": dtype, "live": LIVE_DATA}

@app.get("/api/nfc/locate/{joint_id}")
def get_nfc_localization(joint_id: str):
    info = NFC_REGISTRY.get(joint_id, NFC_REGISTRY["J001"])
    # Calculate defect chainage offset if defect active
    offset_m = 0.0
    if LIVE_DATA["damage_type"] != "NORMAL_BELT":
        offset_m = 1.35  # defect located 1.35m downstream of NFC tag
        
    return {
        "joint_id": info["joint_id"],
        "nfc_tag_id": info["nfc_tag_id"],
        "tag_chainage_m": info["chainage_m"],
        "defect_localized_chainage_m": round(info["chainage_m"] + offset_m, 2),
        "zone": info["zone"],
        "gps_coords": info["gps_coords"],
        "substation_bay": info["substation_bay"],
        "splice_type": info["splice_type"],
        "inspection_count": info["inspection_count"],
        "damage_type": LIVE_DATA["damage_type"],
        "damage_class_name": LIVE_DATA["damage_class_name"],
        "severity": LIVE_DATA["damage_severity"],
        "dispatch_recommendation": f"Dispatch repair crew to {info['substation_bay']} ({info['zone']}). Defect localized at chainage {round(info['chainage_m'] + offset_m, 2)}m."
    }

@app.get("/api/predictive/rul/{joint_id}")
def get_predictive_rul(joint_id: str):
    info = NFC_REGISTRY.get(joint_id, NFC_REGISTRY["J001"])
    update_live_health()
    
    # 30-day forecast degradation curve
    days = list(range(0, 31, 2))
    base_health = LIVE_DATA["health_score"]
    decay_rate = 0.2 if LIVE_DATA["damage_type"] == "NORMAL_BELT" else (2.4 if LIVE_DATA["is_early_warning"] else 5.8)
    
    forecast = []
    for d in days:
        h = max(0.0, base_health - (d * decay_rate) - (0.05 * d * d if d > 10 else 0))
        forecast.append({"day": d, "predicted_health": round(h, 1)})
        
    return {
        "joint_id": joint_id,
        "nfc_tag_id": info["nfc_tag_id"],
        "current_health": LIVE_DATA["health_score"],
        "rul_hours": LIVE_DATA["rul_hours"],
        "failure_probability_24h": LIVE_DATA["failure_probability_24h"],
        "failure_probability_7d": LIVE_DATA["failure_probability_7d"],
        "failure_probability_30d": LIVE_DATA["failure_probability_30d"],
        "forecast_curve": forecast,
        "prescriptive_action": LIVE_DATA["prescriptive_action"]
    }

# ================= 9. STATIC FILE SERVING =================
@app.get("/")
def get_index():
    return FileResponse("index.html")

@app.get("/styles.css")
def get_styles():
    return FileResponse("styles.css", media_type="text/css")

@app.get("/app.js")
def get_app_js():
    return FileResponse("app.js", media_type="application/javascript")

@app.get("/digital_twin_3d.js")
def get_digital_twin_js():
    return FileResponse("digital_twin_3d.js", media_type="application/javascript")

# Mount libs for Three.js & OrbitControls
if os.path.exists("libs"):
    try:
        app.mount("/libs", StaticFiles(directory="libs"), name="libs")
    except Exception:
        pass

# Fallback mount for other assets if any
if os.path.exists("index.html"):
    try:
        app.mount("/static", StaticFiles(directory="."), name="static")
    except Exception:
        pass

# ================= 10. RUN SERVER =================
if __name__ == "__main__":
    print("🚀 Starting Smart Belt AI Predictive Maintenance & 3D Digital Twin Backend on http://127.0.0.1:8000 ...")
    threading.Thread(target=run_vision_and_mqtt, daemon=True).start()
    uvicorn.run(app, host="0.0.0.0", port=8000)