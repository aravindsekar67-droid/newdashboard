/* ==========================================================================
   SMART-BELT AI — Main Dashboard Application Controller (Industrial Telemetry)
   ========================================================================== */

let audioContext = null;
let alarmOscillator = null;
let isAlarmSounding = false;
let currentJointId = "J001";
let demoModeActive = true;

// Chart references
let liveSensorsChart = null;
let predictiveTrendChart = null;

// =========================================================================
// CENTRAL SENSOR TELEMETRY STATE
// All dashboard components read and synchronize from this ONE single source.
// =========================================================================
let clientState = {
    // Current Live Physical Readings
    temperature: 42.5,
    vibration: 1.10,
    sound: 55.0,
    belt_speed_mps: 2.50,
    tension: 5.2,
    alignment: "CENTERED",
    camera_result: "NORMAL",

    // Dynamic Target Values for Organic, Gradual Sensor Interpolation
    target_temperature: 42.5,
    target_vibration: 1.10,
    target_sound: 55.0,
    target_speed: 2.50,
    target_tension: 5.2,
    target_alignment: "CENTERED",
    target_camera_result: "NORMAL",

    // Conveyor Kinematics & Active Joint Tracking
    conveyor_status: "RUNNING",
    current_idx: 0,
    joints: ["J001", "J002", "J003", "J004", "J005", "J006", "J007", "J008", "J009", "J010"],

    // Diagnostic / Fault Injection State
    fault_active: false,
    active_fault: "NORMAL_BELT",
    active_alert: null,

    // Statistics Counter
    total_inspections: 148,
    warning_count: 0,
    critical_count: 0,

    // Unified Health Score & Risk Level
    health_score: 95.4,
    risk_level: "NORMAL",

    // Master Inspection History Buffer
    history: []
};

// =========================================================================
// UNIFIED SENSOR HEALTH SCORE & RISK CALCULATION
// 80–100 = NORMAL | 50–79 = WARNING | 0–49 = CRITICAL
// All components (AI Health Score, Risk badge, Scan Station color,
// Conveyor joint status, Predictive diagnostics, History table) share this EXACT formula.
// =========================================================================

function calculateHealthScore(vib, temp, sound, tension, alignment, cameraResult) {
    let deduction = 0.0;

    // 1. Vibration factor:
    // NORMAL: 0.5–1.5 g (nominal ~1.10 g, minimal deduction)
    // WARNING: 1.5–2.5 g (moderate deduction)
    // CRITICAL: 2.5–4.0 g (critical deduction)
    if (vib <= 1.5) {
        deduction += Math.max(0, (vib - 0.5) * 3.5);
    } else if (vib <= 2.5) {
        deduction += 3.5 + (vib - 1.5) * 22.0;
    } else {
        deduction += 25.5 + (vib - 2.5) * 25.0;
    }

    // 2. Temperature factor:
    // NORMAL: 35–50 °C (nominal ~42.5 °C, minimal deduction)
    // WARNING: 50–60 °C
    // CRITICAL: 60–75 °C
    if (temp <= 50.0) {
        deduction += Math.max(0, (temp - 35.0) * 0.2);
    } else if (temp <= 60.0) {
        deduction += 3.0 + (temp - 50.0) * 1.5;
    } else {
        deduction += 18.0 + (temp - 60.0) * 1.6;
    }

    // 3. Sound factor:
    // NORMAL: 45–65 dB (nominal ~55 dB, minimal deduction)
    // WARNING: 65–80 dB
    // CRITICAL: 80–100 dB
    if (sound <= 65.0) {
        deduction += Math.max(0, (sound - 45.0) * 0.1);
    } else if (sound <= 80.0) {
        deduction += 2.0 + (sound - 65.0) * 0.6;
    } else {
        deduction += 11.0 + (sound - 80.0) * 0.8;
    }

    // 4. Tension factor: NORMAL: 4–7 (nominal ~5.2)
    if (tension < 4.0) {
        deduction += (4.0 - tension) * 6.0;
    } else if (tension > 7.0) {
        deduction += (tension - 7.0) * 6.0;
    }

    // 5. Alignment factor:
    // CENTERED = normal, MISALIGNED = abnormal
    if (alignment === "MISALIGNED" || alignment === "SEVERE_SKEW" || alignment === "DISPLACED" || alignment === "DRIFT_LEFT" || alignment === "WANDERING") {
        deduction += 25.0;
    }

    // 6. Camera / Visual defect factor:
    if (cameraResult && cameraResult !== "NORMAL") {
        if (cameraResult.includes("RUPTURE") || cameraResult.includes("TEAR") || cameraResult.includes("RIP") || cameraResult.includes("SEPARATION") || cameraResult.includes("DAMAGE")) {
            deduction += 45.0;
        } else {
            deduction += 15.0;
        }
    }

    const health = parseFloat(Math.max(0.0, Math.min(100.0, 100.0 - deduction)).toFixed(1));
    return health;
}

// Backward-compatible alias
const calculateDemoHealthScore = calculateHealthScore;

function getRiskLevel(health) {
    if (health >= 80.0) return "NORMAL";
    if (health >= 50.0) return "WARNING";
    return "CRITICAL";
}

// Initialize Client History with realistic baseline entries
(function seedClientHistory() {
    const now = Date.now();
    for (let i = 0; i < 15; i++) {
        const d = new Date(now - (15 - i) * 12000);
        const tStr = d.toISOString().replace('T', ' ').substring(0, 19);
        const jId = clientState.joints[i % 10];
        const nfcTag = `NFC-${jId}`;
        const vib = parseFloat((1.05 + Math.sin(i * 0.6) * 0.08).toFixed(2));
        const temp = parseFloat((42.2 + Math.cos(i * 0.5) * 0.5).toFixed(1));
        const sound = parseFloat((55.0 + Math.sin(i * 0.7) * 1.2).toFixed(1));
        const speed = 2.50;
        const align = "CENTERED";
        const tension = 5.2;
        const camRes = "NORMAL";
        const health = calculateHealthScore(vib, temp, sound, tension, align, camRes);
        const risk = getRiskLevel(health);

        clientState.history.unshift({
            timestamp: tStr,
            joint_id: jId,
            nfc_tag_id: nfcTag,
            temperature_c: temp,
            vibration_g: vib,
            sound_db: sound,
            belt_speed_mps: speed,
            alignment: align,
            tension: tension,
            camera_result: camRes,
            health_score: health,
            risk_level: risk
        });
    }
})();

// =========================================================================
// APPLICATION LIFECYCLE
// =========================================================================

document.addEventListener("DOMContentLoaded", () => {
    initLiveSensorsChart();
    initConveyorBeltTrack();

    // Initialize 3D Digital Twin Engine
    try {
        if (typeof window.DigitalTwin3D === "function") {
            window.digitalTwin = new window.DigitalTwin3D("digital-twin-container");
        }
    } catch (err) {
        console.warn("DigitalTwin3D initialization error:", err);
    }

    startWebcam(); // Connect laptop / external USB webcam
    fetchTelemetry();
    loadJointPredictiveTrend("J001", false);
    applyHistoryFilters();

    // Poll continuous telemetry updater every 1.2 seconds
    setInterval(fetchTelemetry, 1200);
});

// =========================================================================
// TELEMETRY FETCH & DISPATCHER
// =========================================================================

async function fetchTelemetry() {
    // Generate realistic, smoothly changing sensor readings internally
    runClientTelemetrySimulation();
}

// =========================================================================
// REAL-TIME SENSOR TELEMETRY ENGINE (~1.2s update frequency)
// Smooth gradual drift, realistic industrial ranges, responsive health score
// =========================================================================

function runClientTelemetrySimulation() {
    const isRunning = clientState.conveyor_status === "RUNNING";

    if (isRunning) {
        clientState.total_inspections++;
        clientState.current_idx = (clientState.current_idx + 1) % clientState.joints.length;
    }

    const currentJ = clientState.joints[clientState.current_idx];
    const nfcTag = `NFC-${currentJ}`;

    // 1. Establish targets based on operating mode / fault injection
    if (clientState.fault_active) {
        const fault = clientState.active_fault || "TRANSVERSE_TEAR";

        if (fault === "TRANSVERSE_TEAR") {
            clientState.target_vibration = 3.55;
            clientState.target_temperature = 68.5;
            clientState.target_sound = 92.0;
            clientState.target_tension = 2.4;
            clientState.target_speed = 0.0;
            clientState.target_alignment = "MISALIGNED";
            clientState.target_camera_result = "JOINT RUPTURE";
            clientState.conveyor_status = "EMERGENCY STOP";
        } else if (fault === "SEVERE_RUPTURE") {
            clientState.target_vibration = 3.90;
            clientState.target_temperature = 72.5;
            clientState.target_sound = 98.0;
            clientState.target_tension = 1.6;
            clientState.target_speed = 0.0;
            clientState.target_alignment = "DISPLACED";
            clientState.target_camera_result = "CARCASS RUPTURE";
            clientState.conveyor_status = "EMERGENCY STOP";
        } else if (fault === "LONGITUDINAL_RUPTURE") {
            clientState.target_vibration = 3.35;
            clientState.target_temperature = 66.0;
            clientState.target_sound = 90.0;
            clientState.target_tension = 2.1;
            clientState.target_speed = 0.0;
            clientState.target_alignment = "SEVERE_SKEW";
            clientState.target_camera_result = "LONGITUDINAL RIP";
            clientState.conveyor_status = "EMERGENCY STOP";
        } else if (fault === "SMALL_CRACKS") {
            clientState.target_vibration = 1.70;
            clientState.target_temperature = 53.5;
            clientState.target_sound = 68.0;
            clientState.target_tension = 5.0;
            clientState.target_speed = isRunning ? 2.50 : 0.0;
            clientState.target_alignment = "CENTERED";
            clientState.target_camera_result = "SURFACE CRACK";
        } else if (fault === "FRAYING") {
            clientState.target_vibration = 1.85;
            clientState.target_temperature = 55.0;
            clientState.target_sound = 71.0;
            clientState.target_tension = 4.8;
            clientState.target_speed = isRunning ? 2.50 : 0.0;
            clientState.target_alignment = "CENTERED";
            clientState.target_camera_result = "CORD FRAYING";
        } else if (fault === "BELT_MISALIGNMENT") {
            clientState.target_vibration = 2.10;
            clientState.target_temperature = 58.0;
            clientState.target_sound = 76.0;
            clientState.target_tension = 6.4;
            clientState.target_speed = isRunning ? 2.30 : 0.0;
            clientState.target_alignment = "MISALIGNED";
            clientState.target_camera_result = "TRACKING OFFSET";
        } else {
            clientState.target_vibration = 3.20;
            clientState.target_temperature = 66.0;
            clientState.target_sound = 88.0;
            clientState.target_tension = 2.4;
            clientState.target_speed = 0.0;
            clientState.target_alignment = "MISALIGNED";
            clientState.target_camera_result = "FAULT DETECTED";
            clientState.conveyor_status = "EMERGENCY STOP";
        }
    } else {
        // Normal base operating targets:
        clientState.target_temperature = 42.5;
        clientState.target_vibration = 1.10;
        clientState.target_sound = 55.0;
        clientState.target_tension = 5.2;
        clientState.target_speed = isRunning ? 2.50 : 0.0;
        clientState.target_alignment = "CENTERED";
        clientState.target_camera_result = "NORMAL";
    }

    // 2. Realistic gradual drift towards targets
    const isRapidTrip = clientState.fault_active && clientState.vibration < 2.0;
    const rate = isRapidTrip ? 0.70 : 0.28;

    // Temperature: 42.1 -> 42.3 -> 42.5 -> 42.4 -> 42.7
    const tNoise = (Math.random() - 0.48) * 0.22;
    const tDiff = clientState.target_temperature - clientState.temperature;
    clientState.temperature = parseFloat(
        Math.max(30.0, Math.min(85.0, clientState.temperature + tDiff * rate + tNoise)).toFixed(1)
    );

    // Vibration: 1.05 -> 1.08 -> 1.11 -> 1.09 -> 1.13
    const vNoise = (Math.random() - 0.48) * 0.025;
    const vDiff = clientState.target_vibration - clientState.vibration;
    clientState.vibration = parseFloat(
        Math.max(0.40, Math.min(4.50, clientState.vibration + vDiff * rate + vNoise)).toFixed(2)
    );

    // Sound: 54 -> 55 -> 55 -> 56 -> 55
    const sNoise = (Math.random() - 0.48) * 0.7;
    const sDiff = clientState.target_sound - clientState.sound;
    clientState.sound = parseFloat(
        Math.max(40.0, Math.min(110.0, clientState.sound + sDiff * rate + sNoise)).toFixed(1)
    );

    // Belt speed: 2.48 -> 2.50 -> 2.51 -> 2.49 -> 2.50
    if (clientState.conveyor_status === "RUNNING") {
        const spdNoise = (Math.random() - 0.48) * 0.015;
        const spdDiff = clientState.target_speed - clientState.belt_speed_mps;
        clientState.belt_speed_mps = parseFloat(
            Math.max(0.0, Math.min(3.5, clientState.belt_speed_mps + spdDiff * rate + spdNoise)).toFixed(2)
        );
    } else {
        clientState.belt_speed_mps = 0.0;
    }

    // Tension: 5.1 -> 5.2 -> 5.1 -> 5.3
    const tnNoise = (Math.random() - 0.48) * 0.06;
    const tnDiff = clientState.target_tension - clientState.tension;
    clientState.tension = parseFloat(
        Math.max(1.0, Math.min(10.0, clientState.tension + tnDiff * rate + tnNoise)).toFixed(1)
    );

    clientState.alignment = clientState.target_alignment;
    clientState.camera_result = clientState.target_camera_result;

    // 3. Central unified health score & risk calculation
    clientState.health_score = calculateHealthScore(
        clientState.vibration,
        clientState.temperature,
        clientState.sound,
        clientState.tension,
        clientState.alignment,
        clientState.camera_result
    );
    clientState.risk_level = getRiskLevel(clientState.health_score);

    // 4. Create single unified reading object for all dashboard components
    const d = new Date();
    const tStr = d.toISOString().replace('T', ' ').substring(0, 19);

    const latestReading = {
        timestamp: tStr,
        joint_id: currentJ,
        nfc_tag_id: nfcTag,
        temperature_c: clientState.temperature,
        vibration_g: clientState.vibration,
        sound_db: clientState.sound,
        belt_speed_mps: clientState.belt_speed_mps,
        alignment: clientState.alignment,
        tension: clientState.tension,
        camera_result: clientState.camera_result,
        health_score: clientState.health_score,
        risk_level: clientState.risk_level
    };

    // Update central history buffer
    clientState.history.unshift(latestReading);
    if (clientState.history.length > 100) clientState.history.pop();

    const data = {
        conveyor_status: clientState.conveyor_status,
        belt_speed_mps: clientState.belt_speed_mps,
        total_inspections: clientState.total_inspections,
        warning_count: clientState.warning_count,
        critical_count: clientState.critical_count,
        latest_reading: latestReading,
        active_alert: clientState.active_alert
    };

    updateDashboardUI(data);
}

// Backward-compatible alias
const runCentralTelemetryUpdate = runClientTelemetrySimulation;

// =========================================================================
// DASHBOARD UI SYNCHRONIZER
// =========================================================================

function updateDashboardUI(data) {
    // 1. Conveyor Status & Speed
    const statusText = data.conveyor_status || "STOPPED";
    const speed = data.belt_speed_mps || 0.0;
    
    const kpiStatus = document.getElementById("kpi-status-text");
    if (kpiStatus) kpiStatus.innerText = statusText;

    const kpiSpeed = document.getElementById("kpi-speed");
    if (kpiSpeed) kpiSpeed.innerText = speed.toFixed(2);
    
    const statusBadge = document.getElementById("badge-conveyor-status");
    if (statusBadge) {
        statusBadge.innerText = statusText;
        statusBadge.className = "badge " + (statusText === "RUNNING" ? "badge-normal" : "badge-critical");
    }

    // Header Status Pill
    const modeText = document.getElementById("system-mode-text");
    const modeToggle = document.getElementById("demo-mode-toggle");
    if (modeToggle) modeToggle.checked = true;
    if (modeText) {
        modeText.innerText = "SYSTEM ONLINE";
    }

    // 2. Statistics Counter
    const statTotal = document.getElementById("kpi-total-inspections") || document.getElementById("stat-total-inspected");
    if (statTotal) statTotal.innerText = data.total_inspections || 0;
    const statWarn = document.getElementById("kpi-warning-count") || document.getElementById("stat-warnings");
    if (statWarn) statWarn.innerText = data.warning_count || 0;
    const statCrit = document.getElementById("kpi-critical-count") || document.getElementById("stat-criticals");
    if (statCrit) statCrit.innerText = data.critical_count || 0;

    // 3. Latest Sensor Reading
    const latest = data.latest_reading;
    if (latest) {
        currentJointId = latest.joint_id;
        const jIdElem = document.getElementById("kpi-joint-id");
        if (jIdElem) jIdElem.innerText = latest.joint_id;

        const rfidElem = document.getElementById("kpi-rfid-tag");
        if (rfidElem) rfidElem.innerText = latest.nfc_tag_id || `NFC-${latest.joint_id}`;

        const timeElem = document.getElementById("kpi-last-time");
        if (timeElem) timeElem.innerText = latest.timestamp ? latest.timestamp.split(" ")[1] : "Just now";

        // Sensor Cards
        const temp = latest.temperature_c;
        const vib = latest.vibration_g;
        const sound = latest.sound_db;

        const kTemp = document.getElementById("kpi-temp");
        if (kTemp) kTemp.innerHTML = `${temp.toFixed(1)} <span class="unit">°C</span>`;

        const kVib = document.getElementById("kpi-vib");
        if (kVib) kVib.innerHTML = `${vib.toFixed(2)} <span class="unit">g</span>`;

        const kSound = document.getElementById("kpi-sound");
        if (kSound) kSound.innerHTML = `${sound.toFixed(1)} <span class="unit">dB</span>`;

        // Progress Bars
        const tProg = document.getElementById("temp-progress");
        if (tProg) tProg.style.width = `${Math.min(100, Math.max(5, (temp / 80) * 100))}%`;

        const vProg = document.getElementById("vib-progress");
        if (vProg) vProg.style.width = `${Math.min(100, Math.max(5, (vib / 4.0) * 100))}%`;

        const sProg = document.getElementById("sound-progress");
        if (sProg) sProg.style.width = `${Math.min(100, Math.max(5, (sound / 100) * 100))}%`;

        // Single Unified Health Score & Risk
        const health = latest.health_score;
        const risk = latest.risk_level;

        // Update AI Health Score Card & Gauge
        updateHealthGauge(health, risk);

        // Update Scan Station Color (Green 80-100, Amber 50-79, Red 0-49)
        updateScanStationColor(health);

        // Update Live Sensor Waveforms Chart
        updateLiveSensorsChart(latest.timestamp, vib, temp, sound);

        // Update External USB Camera View & Analysis
        updateCameraView(latest.joint_id, latest.camera_result, latest.timestamp);

        // Highlight Active Joint on Conveyor Belt Track
        updateActiveJointOnBelt(latest.joint_id, risk);

        // Update 3D Digital Twin Simulation (movement, joint tracking, laser scan, defects)
        if (window.digitalTwin) {
            window.digitalTwin.update(data);
        }

        // Update Predictive Diagnostics UI with the same health score
        updatePredictiveDiagnosticsUI(latest.joint_id, health, risk);

        // Continuously refresh history table so records appear dynamically
        renderHistoryTable(getFilteredHistory());
    }

    // 4. Handle Critical Alarm Banner & Web Audio Synthesizer
    const activeAlert = data.active_alert;
    const banner = document.getElementById("critical-alarm-banner") || document.getElementById("alarm-banner");
    
    if (banner) {
        if (activeAlert && !activeAlert.acknowledged && (activeAlert.severity === "CRITICAL" || activeAlert.severity === "HIGH")) {
            banner.classList.remove("hidden");
            const aTitle = document.getElementById("alarm-title");
            if (aTitle) aTitle.innerHTML = `<i class="fa-solid fa-circle-exclamation"></i> CRITICAL ALERT: ${activeAlert.joint_id}`;
            
            const aMsg = document.getElementById("alarm-message") || document.getElementById("alarm-desc");
            if (aMsg) aMsg.innerText = activeAlert.reason;
            
            startAlarmAudio();
        } else {
            banner.classList.add("hidden");
            stopAlarmAudio();
        }
    }

    // 5. Update Industrial Safety Light & Andon Tower
    const risk = (data.latest_reading && data.latest_reading.risk_level) ? data.latest_reading.risk_level : "NORMAL";
    updateSafetyLightUI(risk, clientState.active_fault, activeAlert);
}

// =========================================================================
// INDUSTRIAL SAFETY LIGHT (ANDON TOWER) UI SYNCHRONIZER
// =========================================================================

function updateSafetyLightUI(risk, faultType, alert) {
    const lampRed = document.getElementById("andon-lamp-red");
    const lampAmber = document.getElementById("andon-lamp-amber");
    const lampGreen = document.getElementById("andon-lamp-green");
    const mainBadge = document.getElementById("safety-main-badge");
    const interlockBadge = document.getElementById("safety-interlock-badge");
    const headline = document.getElementById("safety-headline-text");
    const subtext = document.getElementById("safety-subtext");
    const presText = document.getElementById("safety-prescriptive-text");

    if (!lampRed || !lampAmber || !lampGreen) return;

    lampRed.classList.remove("active");
    lampAmber.classList.remove("active");
    lampGreen.classList.remove("active");

    const isRupture = (faultType === "TRANSVERSE_TEAR" || faultType === "SEVERE_RUPTURE" || faultType === "LONGITUDINAL_RUPTURE");
    const isCritical = (risk === "CRITICAL" || isRupture);
    const isWarning = (!isCritical && (risk === "WARNING" || faultType === "SMALL_CRACKS" || faultType === "FRAYING" || faultType === "EDGE_WEAR" || faultType === "BELT_MISALIGNMENT"));

    if (isCritical) {
        // RED LAMP ACTIVE (Joint Rupture / Critical Error)
        lampRed.classList.add("active");

        if (mainBadge) {
            mainBadge.className = "safety-indicator-badge critical";
            mainBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> SAFETY LIGHT: CRITICAL TRIP (RED)`;
        }
        if (interlockBadge) {
            interlockBadge.className = "safety-interlock-badge open";
            interlockBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> INTERLOCK: OPEN / TRIPPED`;
        }

        if (headline) {
            if (faultType === "TRANSVERSE_TEAR") {
                headline.innerText = "CRITICAL SAFETY TRIP: Joint Rupture (Transverse Splice Tear) Detected!";
            } else if (faultType === "SEVERE_RUPTURE") {
                headline.innerText = "CATASTROPHIC TRIP: Severe Joint Rupture & Carcass Separation!";
            } else if (faultType === "LONGITUDINAL_RUPTURE") {
                headline.innerText = "CRITICAL SAFETY TRIP: Longitudinal Belt Rupture Slit!";
            } else {
                headline.innerText = "CRITICAL SAFETY TRIP: Structural Integrity Breach!";
            }
        }

        if (subtext) {
            subtext.innerText = "Safety interlock circuit opened. Drive motor isolated to protect conveyor system and prevent tear propagation.";
        }
        if (presText) {
            presText.innerText = "EMERGENCY PROTOCOL: Lockout/Tagout engaged. Splice vulcanizing repair crew dispatched to substation bay.";
        }

        // 3D Digital Twin Sync
        if (window.digitalTwin && window.digitalTwin.setSafetyLight) {
            window.digitalTwin.setSafetyLight("CRITICAL");
        }
    } else if (isWarning) {
        // AMBER LAMP ACTIVE (Early Warning / Minor Fault)
        lampAmber.classList.add("active");

        if (mainBadge) {
            mainBadge.className = "safety-indicator-badge warning";
            mainBadge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> SAFETY LIGHT: PREDICTIVE WARNING (AMBER)`;
        }
        if (interlockBadge) {
            interlockBadge.className = "safety-interlock-badge closed";
            interlockBadge.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> INTERLOCK: MONITORING ACTIVE`;
        }

        if (headline) {
            if (faultType === "SMALL_CRACKS") {
                headline.innerText = "PREDICTIVE EARLY WARNING: Surface Micro-Cracks Detected";
            } else if (faultType === "FRAYING") {
                headline.innerText = "PREDICTIVE EARLY WARNING: Cord Fiber Fraying Detected";
            } else if (faultType === "BELT_MISALIGNMENT") {
                headline.innerText = "TRACKING FAULT: Belt Wandering >25mm Lateral Offset";
            } else {
                headline.innerText = "PREDICTIVE EARLY WARNING: Sensor Anomaly Flagged";
            }
        }

        if (subtext) {
            subtext.innerText = "Splice condition within early warning boundary. Multi-sensor fusion projects degradation ahead of scheduled shift.";
        }
        if (presText) {
            presText.innerText = "PREVENTIVE ACTION: Re-align tracking idlers and apply elastomer conditioner during next shift.";
        }

        // 3D Digital Twin Sync
        if (window.digitalTwin && window.digitalTwin.setSafetyLight) {
            window.digitalTwin.setSafetyLight("WARNING");
        }
    } else {
        // GREEN LAMP ACTIVE (Normal Operation)
        lampGreen.classList.add("active");

        if (mainBadge) {
            mainBadge.className = "safety-indicator-badge safe";
            mainBadge.innerHTML = `<i class="fa-solid fa-shield-halved"></i> SAFETY LIGHT: NORMAL (GREEN)`;
        }
        if (interlockBadge) {
            interlockBadge.className = "safety-interlock-badge closed";
            interlockBadge.innerHTML = `<i class="fa-solid fa-lock"></i> INTERLOCK: ENERGIZED`;
        }
        if (headline) {
            headline.innerText = "Conveyor Structural Splice Integrity Nominal";
        }
        if (subtext) {
            subtext.innerText = "All 10 vulcanized splices verified safe. Optical scan laser & acoustic telemetry operating nominally.";
        }
        if (presText) {
            presText.innerText = "Routine scheduled inspection. Conveyor drive running with safety interlock closed.";
        }

        // 3D Digital Twin Sync
        if (window.digitalTwin && window.digitalTwin.setSafetyLight) {
            window.digitalTwin.setSafetyLight("NORMAL");
        }
    }
}

// =========================================================================
// HEALTH GAUGE RENDERER
// =========================================================================

function updateHealthGauge(health, risk) {
    const kHealth = document.getElementById("kpi-health-score") || document.getElementById("kpi-health-number");
    if (kHealth) kHealth.innerText = health.toFixed(1);
    
    const riskBadge = document.getElementById("badge-risk-level") || document.getElementById("joint-status-badge");
    const bandText = document.getElementById("health-band-name") || document.getElementById("kpi-health-band");
    const fillPath = document.getElementById("gauge-fill-path") || document.getElementById("gauge-arc");

    if (riskBadge) {
        riskBadge.innerText = `${risk} RISK`;
        if (risk === "NORMAL") riskBadge.className = "badge badge-normal";
        else if (risk === "WARNING") riskBadge.className = "badge badge-warning";
        else riskBadge.className = "badge badge-critical";
    }

    // SVG arc stroke-dasharray is 126. Total arc offset: 126 = 0% health, 0 = 100% health
    const offset = 126 - (health / 100) * 126;
    if (fillPath) fillPath.style.strokeDashoffset = offset;

    if (health >= 80) {
        if (fillPath) fillPath.style.stroke = "#10b981";
        if (bandText) {
            bandText.innerText = "NORMAL (80-100%)";
            bandText.className = "health-band-indicator text-green";
        }
    } else if (health >= 50) {
        if (fillPath) fillPath.style.stroke = "#f59e0b";
        if (bandText) {
            bandText.innerText = "WARNING (50-79%)";
            bandText.className = "health-band-indicator text-yellow";
        }
    } else {
        if (fillPath) fillPath.style.stroke = "#ef4444";
        if (bandText) {
            bandText.innerText = "CRITICAL (0-49%)";
            bandText.className = "health-band-indicator text-red";
        }
    }
}

// =========================================================================
// SCAN STATION COLOR SYNCHRONIZATION
// =========================================================================

function updateScanStationColor(health) {
    const scanStation = document.getElementById("scan-station-head") || document.querySelector(".sensor-head");
    const scanBeam = document.getElementById("scan-beam") || document.querySelector(".scan-beam");
    if (!scanStation) return;

    scanStation.classList.remove("normal", "warning", "critical");
    if (scanBeam) scanBeam.classList.remove("normal", "warning", "critical");

    // Exact Health-based colors:
    // 1. Health score 80–100: GREEN (NORMAL)
    // 2. Health score 50–79: YELLOW/AMBER (WARNING)
    // 3. Health score 0–49: RED (CRITICAL)
    if (health >= 80) {
        scanStation.classList.add("normal");
        if (scanBeam) scanBeam.classList.add("normal");
    } else if (health >= 50) {
        scanStation.classList.add("warning");
        if (scanBeam) scanBeam.classList.add("warning");
    } else {
        scanStation.classList.add("critical");
        if (scanBeam) scanBeam.classList.add("critical");
    }
}

// =========================================================================
// MULTI-SOURCE OPTICAL WEBCAM & AI VISION CONTROLLER
// =========================================================================

let currentCameraSource = "BACKEND";
let localWebcamStream = null;
let simCanvasAnimId = null;
let simBeltOffset = 0;

async function switchCameraSource(source) {
    currentCameraSource = source;
    
    // Tab button indicators
    const tabs = {
        "BACKEND": document.getElementById("tab-src-backend"),
        "BROWSER": document.getElementById("tab-src-browser"),
        "SIM": document.getElementById("tab-src-sim")
    };
    Object.keys(tabs).forEach(k => {
        if (tabs[k]) {
            if (k === source) tabs[k].classList.add("active");
            else tabs[k].classList.remove("active");
        }
    });

    const backendImg = document.getElementById("backend-cam-stream");
    const browserVideo = document.getElementById("webcam-video");
    const simCanvas = document.getElementById("sim-conveyor-canvas");
    const streamBadge = document.getElementById("cam-stream-badge");
    const permOverlay = document.getElementById("cam-permission-overlay");

    // Hide permission overlay by default
    if (permOverlay) permOverlay.classList.add("hidden");

    if (source === "BACKEND") {
        stopBrowserWebcam();
        stopConveyorSimulationCanvas();

        if (browserVideo) browserVideo.style.display = "none";
        if (simCanvas) simCanvas.style.display = "none";
        if (backendImg) {
            backendImg.style.display = "block";
            backendImg.src = "/api/video_feed?t=" + Date.now();
        }

        if (streamBadge) {
            streamBadge.innerHTML = `<span class="cam-dot live"></span><span id="cam-stream-source-name">AI SERVER STREAM (YOLOv8 ACTIVE)</span>`;
        }

        setTimeout(async () => {
            try {
                await fetch("/api/camera/reclaim", { method: "POST" });
            } catch (e) {}
        }, 250);

    } else if (source === "BROWSER") {
        stopConveyorSimulationCanvas();

        if (backendImg) backendImg.style.display = "none";
        if (simCanvas) simCanvas.style.display = "none";
        if (browserVideo) browserVideo.style.display = "block";

        if (streamBadge) {
            streamBadge.innerHTML = `<span class="cam-dot live"></span><span id="cam-stream-source-name">LOCAL WEBCAM (DIRECT BROWSER)</span>`;
        }

        // Release backend lock first so Windows media subsystem frees hardware
        try {
            await fetch("/api/camera/release", { method: "POST" });
        } catch (e) {}

        await new Promise(r => setTimeout(r, 200));
        await startBrowserWebcamDirect();

    } else if (source === "SIM") {
        stopBrowserWebcam();

        if (backendImg) backendImg.style.display = "none";
        if (browserVideo) browserVideo.style.display = "none";
        if (simCanvas) simCanvas.style.display = "block";

        if (streamBadge) {
            streamBadge.innerHTML = `<span class="cam-dot live"></span><span id="cam-stream-source-name">OPTICAL CONVEYOR SCANNER</span>`;
        }

        startConveyorSimulationCanvas();
    }
}

async function startBrowserWebcamDirect() {
    const video = document.getElementById("webcam-video");
    const permOverlay = document.getElementById("cam-permission-overlay");
    const permMsg = document.getElementById("cam-perm-error-msg");

    if (!video) return;

    try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            throw new Error("Browser does not support getUserMedia camera access.");
        }

        if (localWebcamStream) {
            localWebcamStream.getTracks().forEach(t => t.stop());
            localWebcamStream = null;
        }

        const stream = await navigator.mediaDevices.getUserMedia({
            video: {
                width: { ideal: 640 },
                height: { ideal: 360 },
                facingMode: "user"
            },
            audio: false
        });

        localWebcamStream = stream;
        video.srcObject = stream;
        video.play().catch(() => {});

        if (permOverlay) permOverlay.classList.add("hidden");
        console.log("✅ Browser direct local webcam stream active.");
    } catch (err) {
        console.warn("Direct browser webcam access issue:", err);
        if (permOverlay) permOverlay.classList.remove("hidden");
        if (permMsg) {
            if (err.name === "NotAllowedError" || err.name === "PermissionDeniedError") {
                permMsg.innerText = "Camera permission was denied. Click the lock/camera icon in your browser address bar to allow camera access.";
            } else if (err.name === "NotReadableError" || err.name === "TrackStartError") {
                permMsg.innerText = "Camera is currently locked by another application or Windows camera privacy setting is blocking access. Try switching to 'AI Vision Stream' or 'Conveyor Sim'.";
            } else if (err.name === "NotFoundError" || err.name === "DevicesNotFoundError") {
                permMsg.innerText = "No physical camera detected on this system. Switch to 'AI Vision Stream' or 'Conveyor Sim'.";
            } else {
                permMsg.innerText = `Camera hardware notification: ${err.message || err.name}`;
            }
        }
    }
}

function stopBrowserWebcam() {
    if (localWebcamStream) {
        localWebcamStream.getTracks().forEach(t => t.stop());
        localWebcamStream = null;
    }
    const video = document.getElementById("webcam-video");
    if (video) video.srcObject = null;
}

function retryBrowserWebcam() {
    switchCameraSource("BROWSER");
}

function startWebcam() {
    const backendImg = document.getElementById("backend-cam-stream");
    if (backendImg) {
        backendImg.onerror = () => {
            console.warn("Backend MJPEG stream not responding, switching to Conveyor Sim");
            switchCameraSource("SIM");
        };
    }
    switchCameraSource("BACKEND");
}

// Procedural Canvas Conveyor Simulation Stream
function startConveyorSimulationCanvas() {
    if (simCanvasAnimId) return;
    const canvas = document.getElementById("sim-conveyor-canvas");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    function renderFrame() {
        const w = canvas.width || 640;
        const h = canvas.height || 360;

        ctx.fillStyle = "#0c1017";
        ctx.fillRect(0, 0, w, h);

        const beltTop = 70;
        const beltBottom = 290;
        const beltHeight = beltBottom - beltTop;

        // Rubber belt surface
        ctx.fillStyle = "#22252a";
        ctx.fillRect(0, beltTop, w, beltHeight);

        // Guide rails
        ctx.fillStyle = "#475569";
        ctx.fillRect(0, beltTop - 10, w, 10);
        ctx.fillRect(0, beltBottom, w, 10);

        if (clientState.conveyor_status === "RUNNING") {
            simBeltOffset = (simBeltOffset + (clientState.belt_speed_mps * 2.5)) % w;
        }

        // Texture slats
        ctx.strokeStyle = "#2e3440";
        ctx.lineWidth = 1;
        for (let x = 0; x < w; x += 35) {
            const xx = (x + simBeltOffset) % w;
            ctx.beginPath();
            ctx.moveTo(xx, beltTop);
            ctx.lineTo(xx, beltBottom);
            ctx.stroke();
        }

        // Splice marker
        const spliceX = (simBeltOffset * 1.8) % w;
        const currentJ = clientState.joints[clientState.current_idx] || "J001";

        ctx.strokeStyle = "#eab308";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(spliceX, beltTop);
        ctx.lineTo(spliceX + 16, beltBottom);
        ctx.stroke();

        ctx.fillStyle = "#fef08a";
        ctx.font = "bold 11px Inter, sans-serif";
        ctx.fillText(`SPLICE ${currentJ}`, Math.max(10, spliceX - 25), beltTop - 16);

        // Laser scan line
        const isDamaged = clientState.simulated_fault && clientState.active_fault !== "NORMAL_BELT";
        ctx.strokeStyle = isDamaged ? "#ef4444" : "#10b981";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(w / 2, beltTop);
        ctx.lineTo(w / 2, beltBottom);
        ctx.stroke();

        // Laser glow
        ctx.strokeStyle = isDamaged ? "rgba(239, 68, 68, 0.25)" : "rgba(16, 185, 129, 0.25)";
        ctx.lineWidth = 8;
        ctx.beginPath();
        ctx.moveTo(w / 2, beltTop);
        ctx.lineTo(w / 2, beltBottom);
        ctx.stroke();

        if (isDamaged) {
            const fault = clientState.active_fault;
            const cx = (spliceX + 8);
            const cy = (beltTop + beltBottom) / 2;

            ctx.save();
            if (fault === "TRANSVERSE_TEAR" || fault === "SEVERE_RUPTURE") {
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(cx - 24, cy - 35);
                ctx.lineTo(cx + 24, cy + 35);
                ctx.moveTo(cx - 10, cy + 12);
                ctx.lineTo(cx + 28, cy - 18);
                ctx.stroke();

                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 2;
                ctx.strokeRect(cx - 45, cy - 50, 90, 100);

                ctx.fillStyle = "#ef4444";
                ctx.fillRect(cx - 45, cy - 68, 175, 18);
                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 11px monospace";
                ctx.fillText("AI: JOINT RUPTURE 98.4%", cx - 40, cy - 55);
            } else if (fault === "LONGITUDINAL_RUPTURE") {
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(cx - 60, cy);
                ctx.lineTo(cx + 60, cy);
                ctx.stroke();

                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 2;
                ctx.strokeRect(cx - 70, cy - 20, 140, 40);

                ctx.fillStyle = "#ef4444";
                ctx.fillRect(cx - 70, cy - 38, 185, 18);
                ctx.fillStyle = "#ffffff";
                ctx.font = "bold 11px monospace";
                ctx.fillText("AI: LONGITUDINAL RIP 96.1%", cx - 65, cy - 25);
            } else {
                ctx.strokeStyle = "#f59e0b";
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.arc(cx, cy, 18, 0, Math.PI * 2);
                ctx.stroke();

                ctx.fillStyle = "#f59e0b";
                ctx.fillRect(cx - 45, cy - 38, 150, 18);
                ctx.fillStyle = "#000000";
                ctx.font = "bold 10px monospace";
                ctx.fillText(`AI: ${fault} 88.5%`, cx - 40, cy - 25);
            }
            ctx.restore();
        }

        ctx.fillStyle = "#06b6d4";
        ctx.font = "12px monospace";
        ctx.fillText("SMART-BELT AI VISION | OPTICAL SCANNER FEED", 15, 25);
        ctx.fillStyle = "#94a3b8";
        ctx.font = "11px monospace";
        ctx.fillText(`STATUS: ${clientState.conveyor_status} (${clientState.belt_speed_mps.toFixed(2)} m/s) | ACTIVE JOINT: ${currentJ}`, 15, h - 15);

        simCanvasAnimId = requestAnimationFrame(renderFrame);
    }

    simCanvasAnimId = requestAnimationFrame(renderFrame);
}

function stopConveyorSimulationCanvas() {
    if (simCanvasAnimId) {
        cancelAnimationFrame(simCanvasAnimId);
        simCanvasAnimId = null;
    }
}

function updateCameraView(jointId, result, timestamp) {
    const cId = document.getElementById("cam-joint-id-text");
    if (cId) cId.innerText = jointId;

    const cRfid = document.getElementById("cam-overlay-rfid");
    if (cRfid) cRfid.innerText = `NFC-${jointId}`;

    const cTime = document.getElementById("cam-overlay-time");
    if (cTime) cTime.innerText = `STREAM: ${timestamp || "LIVE"}`;

    const camBadge = document.getElementById("camera-result-badge");
    const aiStatus = document.getElementById("cam-ai-status");

    if (result === "NORMAL") {
        if (camBadge) {
            camBadge.innerText = "NORMAL";
            camBadge.className = "badge badge-normal";
        }
        if (aiStatus) {
            aiStatus.innerHTML = `<span class="text-green"><i class="fa-solid fa-circle-check"></i> NO DAMAGE DETECTED</span>`;
        }
    } else {
        if (camBadge) {
            camBadge.innerText = "CRITICAL";
            camBadge.className = "badge badge-critical";
        }
        if (aiStatus) {
            aiStatus.innerHTML = `<span class="text-red"><i class="fa-solid fa-triangle-exclamation"></i> JOINT DAMAGE DETECTED</span>`;
        }
    }
}

// =========================================================================
// CONVEYOR BELT TRACK VISUALIZATION
// =========================================================================

function initConveyorBeltTrack() {
    const surface = document.getElementById("belt-surface");
    if (!surface) return;
    surface.innerHTML = "";

    const joints = clientState.joints;
    
    joints.forEach((jId, idx) => {
        const marker = document.createElement("div");
        marker.className = "moving-joint-marker";
        marker.id = `belt-marker-${jId}`;
        marker.innerText = jId;
        
        const leftPercent = (idx / (joints.length - 1)) * 88 + 5;
        marker.style.left = `${leftPercent}%`;
        surface.appendChild(marker);
    });

    updateScanStationColor(94.5);
}

function updateActiveJointOnBelt(activeJointId, risk) {
    const markers = document.querySelectorAll(".moving-joint-marker");
    markers.forEach(m => {
        m.classList.remove("active-pass", "damaged-pass");
    });

    const activeMarker = document.getElementById(`belt-marker-${activeJointId}`);
    if (activeMarker) {
        if (risk === "CRITICAL") {
            activeMarker.classList.add("damaged-pass");
        } else {
            activeMarker.classList.add("active-pass");
        }
    }
}

// =========================================================================
// REAL-TIME MULTI-SENSOR TELEMETRY TRENDS (CHART.JS)
// =========================================================================

function initLiveSensorsChart() {
    const canvas = document.getElementById("live-sensors-chart") || document.getElementById("liveSensorsChart") || document.getElementById("telemetryChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    liveSensorsChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: [],
            datasets: [
                {
                    label: "Vibration (g x 100)",
                    borderColor: "#06b6d4",
                    backgroundColor: "rgba(6, 182, 212, 0.1)",
                    data: [],
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                },
                {
                    label: "Temperature (°C)",
                    borderColor: "#f59e0b",
                    backgroundColor: "rgba(245, 158, 11, 0.1)",
                    data: [],
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                },
                {
                    label: "Sound (dB)",
                    borderColor: "#8b5cf6",
                    backgroundColor: "rgba(139, 92, 246, 0.1)",
                    data: [],
                    borderWidth: 2,
                    pointRadius: 2,
                    tension: 0.3
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            animation: false,
            scales: {
                x: {
                    grid: { color: "#1e293b" },
                    ticks: { color: "#64748b", font: { size: 10 } }
                },
                y: {
                    grid: { color: "#1e293b" },
                    ticks: { color: "#94a3b8", font: { size: 10 } },
                    suggestedMin: 20,
                    suggestedMax: 150
                }
            },
            plugins: {
                legend: {
                    labels: { color: "#94a3b8", font: { size: 11 } }
                },
                tooltip: {
                    callbacks: {
                        label: function(context) {
                            if (context.datasetIndex === 0) {
                                const actualG = (context.parsed.y / 100).toFixed(2);
                                return `Vibration: ${actualG} g (scaled x100: ${context.parsed.y})`;
                            }
                            return `${context.dataset.label}: ${context.parsed.y}`;
                        }
                    }
                }
            }
        }
    });
}

function updateLiveSensorsChart(timestamp, vib, temp, sound) {
    if (!liveSensorsChart) {
        initLiveSensorsChart();
    }
    if (!liveSensorsChart) return;
    const timeLabel = timestamp ? timestamp.split(" ")[1] : new Date().toLocaleTimeString();

    if (liveSensorsChart.data.labels.length > 15) {
        liveSensorsChart.data.labels.shift();
        liveSensorsChart.data.datasets[0].data.shift();
        liveSensorsChart.data.datasets[1].data.shift();
        liveSensorsChart.data.datasets[2].data.shift();
    }

    liveSensorsChart.data.labels.push(timeLabel);
    liveSensorsChart.data.datasets[0].data.push(parseFloat((vib * 100).toFixed(1)));
    liveSensorsChart.data.datasets[1].data.push(temp);
    liveSensorsChart.data.datasets[2].data.push(sound);
    liveSensorsChart.update();
}

// =========================================================================
// PREDICTIVE HEALTH DIAGNOSTICS & SPLICE FATIGUE TREND
// =========================================================================

function updatePredictiveDiagnosticsUI(jointId, health, risk) {
    const pName = document.getElementById("pred-joint-name");
    if (pName) pName.innerText = jointId;

    const curH = document.getElementById("pred-current-health");
    if (curH) {
        curH.innerText = `${health.toFixed(1)}%`;
        curH.className = health >= 80 ? "text-green" : (health >= 50 ? "text-yellow" : "text-red");
    }

    const daysElem = document.getElementById("pred-est-days");
    const recElem = document.getElementById("pred-recommendation");

    if (health >= 80) {
        if (daysElem) {
            daysElem.innerText = `${Math.round(90 + (health - 80) * 2.5)} Days`;
            daysElem.className = "text-green";
        }
        if (recElem) {
            recElem.innerHTML = `<i class="fa-solid fa-circle-check text-green"></i> 30-Day Trend Normal: Splice matrix nominal. Scheduled routine scan in 30 days.`;
        }
    } else if (health >= 50) {
        if (daysElem) {
            daysElem.innerText = `${Math.round(20 + (health - 50) * 2.0)} Days`;
            daysElem.className = "text-yellow";
        }
        if (recElem) {
            recElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-yellow"></i> 30-Day Trend Warning: Splice degradation accelerated. Schedule vulcanization audit.`;
        }
    } else {
        if (daysElem) {
            daysElem.innerText = `< 3 Days (URGENT)`;
            daysElem.className = "text-red";
        }
        if (recElem) {
            recElem.innerHTML = `<i class="fa-solid fa-triangle-exclamation text-red"></i> Critical Separation Risk: Fatigue degradation breached safe limits. Immediate maintenance required!`;
        }
    }
}

function renderPredictiveTrendChart(historyData) {
    const canvas = document.getElementById("predictive-trend-chart") || document.getElementById("predictiveTrendChart");
    if (!canvas) return;
    const ctx = canvas.getContext("2d");

    const labels = historyData.map(h => h.timestamp.split(" ")[0]);
    const dataPoints = historyData.map(h => h.health_score);

    if (predictiveTrendChart) {
        predictiveTrendChart.data.labels = labels;
        predictiveTrendChart.data.datasets[0].data = dataPoints;
        predictiveTrendChart.update();
        return;
    }

    predictiveTrendChart = new Chart(ctx, {
        type: "line",
        data: {
            labels: labels,
            datasets: [{
                label: "Health Score Trend (%)",
                data: dataPoints,
                borderColor: "#10b981",
                backgroundColor: "rgba(16, 185, 129, 0.1)",
                fill: true,
                tension: 0.3,
                borderWidth: 2
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: { grid: { color: "#1e293b" }, ticks: { color: "#64748b" } },
                y: { min: 0, max: 100, grid: { color: "#1e293b" }, ticks: { color: "#94a3b8" } }
            },
            plugins: {
                legend: { labels: { color: "#94a3b8" } }
            }
        }
    });
}

async function loadJointPredictiveTrend(jointId, showReportModal = true) {
    let historyData = null;
    try {
        const res = await fetch(`/api/history/${jointId}`);
        if (res.ok) {
            const json = await res.json();
            if (json && json.history && json.history.length > 0) {
                historyData = json.history.map(r => ({
                    timestamp: r.timestamp ? r.timestamp.split(" ")[0] : new Date().toISOString().split("T")[0],
                    joint_id: r.joint_id || jointId,
                    health_score: typeof r.health_score === "number" ? r.health_score : parseFloat(r.health_score) || 94.0
                }));
            }
        }
    } catch (e) {}

    if (!historyData || historyData.length === 0) {
        historyData = generateMockJointHistory(jointId);
    }
    renderPredictiveTrendChart(historyData);
    
    if (showReportModal && historyData.length >= 2) {
        const latest = historyData[historyData.length - 1];
        const previous = historyData[historyData.length - 2];
        const wear30Day = parseFloat((previous.health_score - latest.health_score).toFixed(1));
        const estDays = Math.max(1, Math.round((latest.health_score - 30) / (wear30Day > 0 ? wear30Day / 30 : 0.1)));
        trigger30DayAIReport(jointId, latest.health_score, wear30Day, estDays);
    }
}

function generateMockJointHistory(jointId) {
    const mock = [];
    const now = Date.now();
    const thirtyDaysMs = 30 * 86400000;
    
    const jNum = parseInt(jointId.replace("J", ""), 10) || 1;
    const baseHealth = 98 - (jNum % 4) * 1.5;

    for (let i = 0; i < 6; i++) {
        const d = new Date(now - (5 - i) * thirtyDaysMs);
        const degradation = (i * 2.5) + (Math.sin(i) * 0.8);
        const score = parseFloat(Math.min(99.0, Math.max(35.0, baseHealth - degradation)).toFixed(1));

        mock.push({
            timestamp: d.toISOString().split('T')[0],
            joint_id: jointId,
            health_score: score
        });
    }
    return mock;
}

function trigger30DayAIReport(jointId, currentHealth, wearRate, remainingDays) {
    const modal = document.getElementById("trendReportModal");
    if (!modal) return;

    const title = document.getElementById("reportModalTitle");
    const badge = document.getElementById("reportSummaryBadge");
    const text = document.getElementById("reportSummaryText");
    const wearVal = document.getElementById("reportWearRate");
    const estVal = document.getElementById("reportEstDays");

    if (title) title.innerText = `30-Day AI Trend Audit: ${jointId}`;
    if (wearVal) wearVal.innerText = `-${wearRate}% / cycle`;
    if (estVal) estVal.innerText = `${remainingDays} Days`;

    if (currentHealth >= 80) {
        if (badge) {
            badge.className = "report-alert-badge";
            badge.style.borderColor = "#10b981";
            badge.style.color = "#10b981";
            badge.innerText = "NORMAL 30-DAY WEAR RATE";
        }
        if (text) {
            text.innerText = `AI Analysis: Joint ${jointId} degradation over the last 30 days is consistent with nominal mechanical wear (${wearRate}% reduction). Core vulcanized splice layers remain intact. Routine continuous monitoring remains active.`;
        }
    } else if (currentHealth >= 50) {
        if (badge) {
            badge.className = "report-alert-badge";
            badge.style.borderColor = "#f59e0b";
            badge.style.color = "#f59e0b";
            badge.innerText = "ACCELERATED SPLICE FATIGUE";
        }
        if (text) {
            text.innerText = `AI Advisory: Joint ${jointId} is exhibiting accelerated splice fatigue. Vibration and micro-fissure expansion rates have increased across the 30-day baseline. Re-inspection recommended within 14 days.`;
        }
    } else {
        if (badge) {
            badge.className = "report-alert-badge";
            badge.style.borderColor = "#ef4444";
            badge.style.color = "#ef4444";
            badge.innerText = "CRITICAL SEPARATION HAZARD";
        }
        if (text) {
            text.innerText = `AI Urgent Dispatch: Joint ${jointId} has breached the structural safety threshold. Risk of conveyor splice tear is elevated. Immediate maintenance shutdown required.`;
        }
    }

    modal.classList.remove("hidden");
}

function closeTrendReport() {
    const modal = document.getElementById("trendReportModal");
    if (modal) modal.classList.add("hidden");
}

// =========================================================================
// JOINT INSPECTION LOG & HISTORICAL AUDIT TABLE
// =========================================================================

function getFilteredHistory() {
    const jFilterElem = document.getElementById("history-joint-filter") || document.getElementById("filter-joint");
    const rFilterElem = document.getElementById("history-risk-filter") || document.getElementById("filter-risk");
    const jFilter = jFilterElem ? jFilterElem.value : "ALL";
    const rFilter = rFilterElem ? rFilterElem.value : "ALL";

    let records = [...clientState.history];
    if (jFilter !== "ALL") {
        records = records.filter(r => r.joint_id === jFilter);
    }
    if (rFilter !== "ALL") {
        records = records.filter(r => r.risk_level === rFilter);
    }
    return records;
}

function applyHistoryFilters() {
    renderHistoryTable(getFilteredHistory());
}

function renderHistoryTable(records) {
    const tbody = document.getElementById("history-table-body") || document.getElementById("master-joints-tbody");
    if (!tbody) return;
    tbody.innerHTML = "";

    if (!records || records.length === 0) {
        tbody.innerHTML = `<tr><td colspan="10" style="text-align: center; color: #64748b; padding: 20px;">No inspection history records match the filter criteria.</td></tr>`;
        return;
    }

    records.forEach(r => {
        const tr = document.createElement("tr");
        
        let riskClass = "badge-normal";
        if (r.risk_level === "WARNING") riskClass = "badge-warning";
        if (r.risk_level === "CRITICAL") riskClass = "badge-critical";

        tr.innerHTML = `
            <td>${r.timestamp}</td>
            <td><strong style="color: var(--accent-cyan);">${r.joint_id}</strong></td>
            <td><span style="font-size: 11px; color: var(--text-muted);">${r.nfc_tag_id || ('NFC-' + r.joint_id)}</span></td>
            <td>${r.temperature_c.toFixed(1)} °C</td>
            <td>${r.vibration_g.toFixed(2)} g</td>
            <td>${r.sound_db.toFixed(1)} dB</td>
            <td>${r.belt_speed_mps.toFixed(2)} m/s</td>
            <td>${r.camera_result === "NORMAL" ? '<span style="color: var(--status-normal);"><i class="fa-solid fa-circle-check"></i> NORMAL</span>' : '<span style="color: var(--status-critical);"><i class="fa-solid fa-triangle-exclamation"></i> ' + r.camera_result + '</span>'}</td>
            <td><strong>${r.health_score.toFixed(1)}%</strong></td>
            <td><span class="badge ${riskClass}">${r.risk_level}</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function exportHistoryCSV() {
    let csvContent = "data:text/csv;charset=utf-8,Timestamp,Joint_ID,NFC_Tag,Temp_C,Vib_g,Sound_dB,Speed_mps,Camera,Health_Score,Risk\n";
    clientState.history.forEach(r => {
        csvContent += `${r.timestamp},${r.joint_id},${r.nfc_tag_id || ('NFC-' + r.joint_id)},${r.temperature_c},${r.vibration_g},${r.sound_db},${r.belt_speed_mps},${r.camera_result},${r.health_score},${r.risk_level}\n`;
    });
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `smart_belt_inspection_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

// =========================================================================
// CONVEYOR CONTROL ACTIONS
// =========================================================================

function handleMainFaultToggle() {
    if (!clientState.fault_active) {
        simulateSpecificFault("TRANSVERSE_TEAR");
    } else {
        simulateSpecificFault("NORMAL_BELT");
    }
}

function controlConveyor(action) {
    sendConveyorControl(action);
}

function sendConveyorControl(action) {
    if (action === "START") {
        clientState.conveyor_status = "RUNNING";
        clientState.target_speed = 2.50;
    } else if (action === "PAUSE") {
        clientState.conveyor_status = "PAUSED";
        clientState.target_speed = 0.0;
        clientState.belt_speed_mps = 0.0;
    } else if (action === "STOP" || action === "EMERGENCY_STOP" || action === "E-STOP") {
        clientState.conveyor_status = "EMERGENCY STOP";
        clientState.target_speed = 0.0;
        clientState.belt_speed_mps = 0.0;
    }

    try {
        fetch("/api/conveyor/control", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: action })
        }).catch(() => {});
    } catch (e) {}

    runClientTelemetrySimulation();
}

async function fetchPrediction(sensorData) {
    try {
        const payload = sensorData || {
            vibration: clientState.vibration,
            temperature: clientState.temperature,
            sound: clientState.sound,
            tension: clientState.tension,
            damage_type: clientState.active_fault || "NORMAL_BELT",
            alignment_offset_mm: clientState.alignment === "CENTERED" ? 0.0 : 15.0
        };
        const res = await fetch("/api/predict", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(payload)
        });
        if (res.ok) {
            return await res.json();
        }
    } catch (e) {}
    return null;
}
window.fetchPrediction = fetchPrediction;

function simulateDamage() {
    simulateSpecificFault("TRANSVERSE_TEAR");
}

function triggerSimulatedFault() {
    simulateSpecificFault("TRANSVERSE_TEAR");
}

function simulateSpecificFault(damageType) {
    const isReset = (!damageType || damageType === "NORMAL_BELT");
    const btnFaultText = document.getElementById("btn-fault-text");
    const btnFault = document.getElementById("btn-fault");

    // Update console buttons active state
    document.querySelectorAll(".sim-btn").forEach(b => b.classList.remove("active"));

    if (isReset) {
        clientState.fault_active = false;
        clientState.active_fault = "NORMAL_BELT";
        clientState.active_alert = null;
        clientState.target_alignment = "CENTERED";
        clientState.target_camera_result = "NORMAL";
        clientState.conveyor_status = "RUNNING";
        clientState.target_speed = 2.50;
        clientState.target_temperature = 42.5;
        clientState.target_vibration = 1.10;
        clientState.target_sound = 55.0;
        clientState.target_tension = 5.2;

        if (btnFaultText) btnFaultText.innerText = "INJECT FAULT";
        if (btnFault) btnFault.classList.remove("active");

        const normalBtn = document.getElementById("btn-sim-normal");
        if (normalBtn) normalBtn.classList.add("active");

        stopAlarmAudio();
        if (window.digitalTwin && window.digitalTwin.resetDefect) {
            window.digitalTwin.resetDefect();
        }
        if (window.digitalTwin && window.digitalTwin.setSafetyLight) {
            window.digitalTwin.setSafetyLight("NORMAL");
        }

        fetch("/api/simulate/fault", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ fault_type: "NORMAL_BELT" })
        }).catch(() => {});

        runClientTelemetrySimulation();
        return;
    }

    // Abnormal condition triggered
    clientState.fault_active = true;
    clientState.active_fault = damageType;

    if (btnFaultText) btnFaultText.innerText = "CLEAR FAULT";
    if (btnFault) btnFault.classList.add("active");

    const btnIdMap = {
        "TRANSVERSE_TEAR": "btn-sim-transverse",
        "SEVERE_RUPTURE": "btn-sim-severe",
        "LONGITUDINAL_RUPTURE": "btn-sim-longitudinal",
        "SMALL_CRACKS": "btn-sim-cracks",
        "FRAYING": "btn-sim-fray",
        "BELT_MISALIGNMENT": "btn-sim-align"
    };
    if (btnIdMap[damageType]) {
        const btn = document.getElementById(btnIdMap[damageType]);
        if (btn) btn.classList.add("active");
    }

    const isCritical = (damageType === "TRANSVERSE_TEAR" || damageType === "SEVERE_RUPTURE" || damageType === "LONGITUDINAL_RUPTURE");
    const currentJ = clientState.joints[clientState.current_idx];

    if (isCritical) {
        clientState.conveyor_status = "EMERGENCY STOP";
        clientState.belt_speed_mps = 0.0;
        clientState.target_speed = 0.0;
        clientState.active_alert = {
            joint_id: currentJ,
            severity: "CRITICAL",
            reason: `CRITICAL TRIP: Splice rupture condition detected on ${currentJ}. Interlock opened.`,
            acknowledged: false
        };
        startAlarmAudio();
    } else {
        clientState.active_alert = {
            joint_id: currentJ,
            severity: "WARNING",
            reason: `PREDICTIVE ADVISORY: Telemetry anomaly detected on ${currentJ}.`,
            acknowledged: false
        };
    }

    if (window.digitalTwin && window.digitalTwin.simulateDefect) {
        window.digitalTwin.simulateDefect(damageType);
    }

    fetch("/api/simulate/fault", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fault_type: damageType })
    }).catch(() => {});

    runClientTelemetrySimulation();
}

function switchConveyorView(mode) {
    const dtContainer = document.getElementById("digital-twin-container");
    const c2dBox = document.getElementById("conveyor-2d-box");
    const btn3d = document.getElementById("btn-view-3d");
    const btn2d = document.getElementById("btn-view-2d");

    if (mode === "3D") {
        if (dtContainer) dtContainer.style.display = "block";
        if (c2dBox) c2dBox.style.display = "none";
        if (btn3d) btn3d.classList.add("active");
        if (btn2d) btn2d.classList.remove("active");
        if (window.digitalTwin && window.digitalTwin.onWindowResize) {
            setTimeout(() => window.digitalTwin.onWindowResize(), 50);
        }
    } else {
        if (dtContainer) dtContainer.style.display = "none";
        if (c2dBox) c2dBox.style.display = "block";
        if (btn3d) btn3d.classList.remove("active");
        if (btn2d) btn2d.classList.add("active");
    }
}

function toggleDemoMode(enabled) {
    demoModeActive = !!enabled;
    const modeText = document.getElementById("system-mode-text");
    if (modeText) {
        modeText.innerText = "SYSTEM ONLINE";
    }
    runClientTelemetrySimulation();
}

function acknowledgeAlert() {
    if (clientState.active_alert) {
        clientState.active_alert.acknowledged = true;
    }
    stopAlarmAudio();
    runClientTelemetrySimulation();
}

// =========================================================================
// WEB AUDIO SYNTHESIZER FOR INDUSTRIAL ALARM
// =========================================================================

function startAlarmAudio() {
    if (isAlarmSounding) return;
    try {
        if (!audioContext) {
            audioContext = new (window.AudioContext || window.webkitAudioContext)();
        }
        if (audioContext.state === "suspended") {
            audioContext.resume();
        }

        alarmOscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        alarmOscillator.type = "sawtooth";
        alarmOscillator.frequency.setValueAtTime(880, audioContext.currentTime);
        alarmOscillator.frequency.exponentialRampToValueAtTime(440, audioContext.currentTime + 0.5);

        gainNode.gain.setValueAtTime(0.15, audioContext.currentTime);

        alarmOscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        alarmOscillator.start();
        isAlarmSounding = true;
    } catch (e) {
        console.log("Audio play blocked or unavailable:", e);
    }
}

function stopAlarmAudio() {
    if (alarmOscillator && isAlarmSounding) {
        try {
            alarmOscillator.stop();
            alarmOscillator.disconnect();
        } catch (e) {}
        isAlarmSounding = false;
    }
}
