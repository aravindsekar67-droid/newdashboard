import os
import time
import math
import sqlite3
import shutil
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

# ================= 1. FASTAPI SETUP =================
app = FastAPI(
    title="Smart Belt AI - Industrial Conveyor Predictive Maintenance & 3D Digital Twin",
    version="2.0.0"
)

# Proper CORS for Vercel deployment
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
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

# NFC Splice Joint Registry
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

# ================= 3. DATABASE SETUP & HELPER =================
def get_db_file():
    tmp_target = "/tmp/smart_belt.db"
    if os.path.exists("/tmp") and os.access("/tmp", os.W_OK):
        if not os.path.exists(tmp_target):
            for candidate in ["smart_belt.db", os.path.join(os.getcwd(), "smart_belt.db")]:
                if os.path.exists(candidate):
                    try:
                        shutil.copy2(candidate, tmp_target)
                        break
                    except Exception:
                        pass
        if os.path.exists(tmp_target):
            return tmp_target
            
    if os.path.exists("smart_belt.db"):
        return "smart_belt.db"
    return "smart_belt.db"

def init_db():
    try:
        db_path = get_db_file()
        conn = sqlite3.connect(db_path)
        c = conn.cursor()
        c.execute('''CREATE TABLE IF NOT EXISTS joint_logs 
                     (timestamp TEXT, joint_id TEXT, temp REAL, vibration REAL, 
                      speed REAL, alignment TEXT, sound INT, tension REAL, 
                      yolo_damage INT, health_score REAL, status TEXT)''')
        for col, col_type in [
            ("damage_type", "TEXT"),
            ("nfc_tag_id", "TEXT"),
            ("chainage_m", "REAL"),
            ("rul_hours", "REAL"),
            ("failure_prob_24h", "REAL")
        ]:
            try:
                c.execute(f"ALTER TABLE joint_logs ADD COLUMN {col} {col_type}")
            except Exception:
                pass
        conn.commit()
        conn.close()
    except Exception as e:
        print(f"init_db notice: {e}")

init_db()

# ================= 4. LIVE SYSTEM STATE =================
LIVE_DATA = {
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

# ================= 5. SENSOR FUSION & PREDICTIVE MAINTENANCE LOGIC =================
def compute_predictive_metrics(damage_type: str, vib: float, temp: float, sound: float, tension: float, align_offset: float):
    dmg = DAMAGE_CLASSES.get(damage_type, DAMAGE_CLASSES["NORMAL_BELT"])
    
    # 1. Base Health Deduction
    base_deduction = dmg["severity"] * 0.65
    
    # 2. Vibration factor
    vib_deduction = 0.0
    if vib > 2.5:
        vib_deduction = 28.0
    elif vib > 1.2:
        vib_deduction = 14.0
    elif vib > 0.7:
        vib_deduction = 6.0
        
    # 3. Temperature factor
    temp_deduction = 0.0
    if temp > 65.0:
        temp_deduction = 22.0
    elif temp > 50.0:
        temp_deduction = 10.0
    elif temp > 42.0:
        temp_deduction = 4.0
        
    # 4. Sound factor
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
        db_path = get_db_file()
        conn = sqlite3.connect(db_path)
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

# ================= 6. API ENDPOINTS =================
@app.get("/api/sensors")
def get_sensors():
    return [LIVE_DATA]

@app.get("/api/live")
def get_live_data():
    return LIVE_DATA

@app.post("/api/predict")
async def predict(request: Request):
    try:
        data = await request.json()
    except Exception:
        data = {}
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
        db_path = get_db_file()
        conn = sqlite3.connect(db_path)
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
    try:
        db_path = get_db_file()
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        c = conn.cursor()
        c.execute("SELECT * FROM joint_logs WHERE joint_id = ? ORDER BY timestamp DESC LIMIT 50", (joint_id,))
        rows = [dict(ix) for ix in c.fetchall()]
        conn.close()
        return {"joint_id": joint_id, "history": rows}
    except Exception as e:
        return {"joint_id": joint_id, "history": [], "error": str(e)}

@app.post("/api/simulate/fault")
async def simulate_fault(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
    dtype = payload.get("damage_type", payload.get("fault_type", "NORMAL_BELT"))
    if dtype not in DAMAGE_CLASSES:
        dtype = "NORMAL_BELT"
        
    LIVE_DATA["damage_type"] = dtype
    dmg = DAMAGE_CLASSES[dtype]
    
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

@app.post("/api/conveyor/control")
async def conveyor_control(request: Request):
    try:
        payload = await request.json()
    except Exception:
        payload = {}
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

@app.get("/api/nfc/locate/{joint_id}")
def get_nfc_localization(joint_id: str):
    info = NFC_REGISTRY.get(joint_id, NFC_REGISTRY["J001"])
    offset_m = 0.0
    if LIVE_DATA["damage_type"] != "NORMAL_BELT":
        offset_m = 1.35
        
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

@app.post("/api/camera/release")
def api_release_camera():
    return {"status": "ok", "message": "Backend webcam released for browser direct access."}

@app.post("/api/camera/reclaim")
def api_reclaim_camera():
    return {"status": "ok", "message": "Backend webcam reclaimed for AI inference."}

@app.get("/api/camera/status")
def api_camera_status():
    return {
        "camera_enabled": True,
        "is_opened": True,
        "yolo_active": True,
        "current_damage": LIVE_DATA.get("damage_type", "NORMAL_BELT")
    }

@app.post("/api/demo/mode")
async def set_demo_mode(request: Request):
    return {"status": "ok", "demo_mode": True}

@app.post("/api/demo/simulate-damage")
async def demo_simulate_damage(request: Request):
    LIVE_DATA["vibration"] = 3.65
    LIVE_DATA["temperature"] = 69.4
    LIVE_DATA["sound"] = 92
    LIVE_DATA["alignment"] = "MISALIGNED"
    LIVE_DATA["tension"] = 2.1
    LIVE_DATA["damage_type"] = "SEVERE_RUPTURE"
    LIVE_DATA["yolo_damage"] = True
    update_live_health()
    return {"status": "ok", "damage_type": "SEVERE_RUPTURE", "live": LIVE_DATA}



