/* ==========================================================================
   SMART-BELT AI — 3D Digital Twin Engine (Three.js WebGL)
   Simulates physical conveyor rig, 10 moving vulcanized joints,
   real-time belt motion, optical laser scanning, dynamic defect generation,
   and interactive raycast inspection.
   ========================================================================== */

(function (window) {
    'use strict';

    class DigitalTwin3D {
        constructor(containerId) {
            this.container = document.getElementById(containerId);
            if (!this.container) {
                console.warn(`[DigitalTwin3D] Container #${containerId} not found.`);
                return;
            }

            this.scene = null;
            this.camera = null;
            this.renderer = null;
            this.controls = null;
            this.animationFrameId = null;

            // Rig Dimensions & Geometry
            this.beltLength = 32.0;       // Length of horizontal span
            this.beltWidth = 3.6;         // Belt width
            this.pulleyRadius = 1.35;     // Radius of drive and tail pulleys
            this.beltThickness = 0.12;

            // Runtime Simulation State
            this.beltSpeed = 2.50;        // Current velocity in m/s
            this.conveyorStatus = "RUNNING";
            this.activeJointId = "J001";
            this.currentHealth = 94.0;
            this.currentRisk = "NORMAL";
            this.activeDefect = null;     // Current simulated defect object

            // Moving Splices / Joints
            this.jointsCount = 10;
            this.joints = [];
            this.jointMeshes = [];
            this.jointLabels = [];
            this.totalPerimeter = 2 * this.beltLength + 2 * Math.PI * this.pulleyRadius;

            // Scene Components
            this.beltMesh = null;
            this.beltTexture = null;
            this.driveDrum = null;
            this.tailDrum = null;
            this.laserBeam = null;
            this.laserGantry = null;
            this.laserLight = null;
            this.nfcRing = null;
            this.sensorPods = [];
            this.defectMeshGroup = null;
            this.detectionBox = null;
            this.defectBanner = null;

            // Safety Stack Light (3D Andon Tower)
            this.safetyLightTower = null;
            this.meshLampRed = null;
            this.meshLampAmber = null;
            this.meshLampGreen = null;
            this.matLampRed = null;
            this.matLampAmber = null;
            this.matLampGreen = null;
            this.safetyPointLight = null;
            this.safetyState = "NORMAL";

            // Camera presets
            this.cameraPresets = {
                overview: { pos: [22, 16, 26], target: [0, 1, 0] },
                scanner: { pos: [2, 7, 9], target: [0, 1.8, 0] },
                motor: { pos: [19, 6, 8], target: [16, 0.5, 0] },
                topdown: { pos: [0, 30, 0.01], target: [0, 0, 0] }
            };
            this.currentPreset = "overview";
            this.followJoint = false;

            // Raycaster for click-to-inspect
            this.raycaster = new THREE.Raycaster();
            this.mouse = new THREE.Vector2();

            this.init();
        }

        init() {
            const width = this.container.clientWidth || 800;
            const height = this.container.clientHeight || 340;

            // 1. Scene
            this.scene = new THREE.Scene();
            this.scene.background = new THREE.Color(0x070b14);
            this.scene.fog = new THREE.FogExp2(0x070b14, 0.015);

            // 2. Camera
            this.camera = new THREE.PerspectiveCamera(45, width / height, 0.5, 200);
            this.camera.position.set(22, 16, 26);

            // 3. Renderer
            this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
            this.renderer.setSize(width, height);
            this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
            this.renderer.shadowMap.enabled = true;
            this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
            this.container.appendChild(this.renderer.domElement);

            // 4. OrbitControls
            if (THREE.OrbitControls) {
                this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
                this.controls.enableDamping = true;
                this.controls.dampingFactor = 0.05;
                this.controls.maxPolarAngle = Math.PI / 2 - 0.02; // Do not go below floor
                this.controls.minDistance = 6;
                this.controls.maxDistance = 65;
                this.controls.target.set(0, 1.2, 0);
            }

            // 5. Lighting
            this.setupLighting();

            // 6. Environment Floor & Grid
            this.createEnvironment();

            // 7. Structural Frame & Rollers
            this.createStructuralTruss();

            // 8. Continuous Looped Belt
            this.createBeltLoop();

            // 9. 10 Vulcanized Moving Splices
            this.createVulcanizedSplices();

            // 10. Optical Scan Gantry & Laser Fan
            this.createScanGantry();

            // 11. IoT Sensor Pods
            this.createSensorPods();

            // 12. Defect Mesh Container & 3D Bounding Box
            this.createDefectVisualizers();

            // 13. UI Overlays (HUD, Presets, Inspector Tooltip)
            this.createHUDOverlays();

            // 14. Event Listeners
            window.addEventListener('resize', () => this.onWindowResize());
            this.renderer.domElement.addEventListener('click', (e) => this.onCanvasClick(e));

            // 15. Animation Loop
            this.clock = new THREE.Clock();
            this.animate();

            console.log("✅ 3D Digital Twin Engine initialized successfully.");
        }

        setupLighting() {
            const ambient = new THREE.AmbientLight(0x475569, 0.8);
            this.scene.add(ambient);

            const hemi = new THREE.HemisphereLight(0x38bdf8, 0x0f172a, 0.6);
            this.scene.add(hemi);

            const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
            dirLight.position.set(20, 30, 20);
            dirLight.castShadow = true;
            dirLight.shadow.mapSize.width = 2048;
            dirLight.shadow.mapSize.height = 2048;
            dirLight.shadow.camera.near = 1;
            dirLight.shadow.camera.far = 80;
            dirLight.shadow.camera.left = -25;
            dirLight.shadow.camera.right = 25;
            dirLight.shadow.camera.top = 20;
            dirLight.shadow.camera.bottom = -20;
            this.scene.add(dirLight);

            // Colored Industrial Accent Spotlights
            const blueSpot = new THREE.SpotLight(0x06b6d4, 1.5, 45, Math.PI / 4, 0.4);
            blueSpot.position.set(-18, 12, 14);
            this.scene.add(blueSpot);

            const orangeSpot = new THREE.SpotLight(0xf59e0b, 1.0, 45, Math.PI / 4, 0.4);
            orangeSpot.position.set(18, 12, -14);
            this.scene.add(orangeSpot);
        }

        createEnvironment() {
            // Concrete Substation Floor
            const floorGeo = new THREE.PlaneGeometry(80, 50);
            const floorMat = new THREE.MeshStandardMaterial({
                color: 0x0b1120,
                roughness: 0.85,
                metalness: 0.15
            });
            const floor = new THREE.Mesh(floorGeo, floorMat);
            floor.rotation.x = -Math.PI / 2;
            floor.position.y = -2.5;
            floor.receiveShadow = true;
            this.scene.add(floor);

            // High-Tech Industrial Floor Grid
            const grid = new THREE.GridHelper(80, 40, 0x0284c7, 0x1e293b);
            grid.position.y = -2.49;
            this.scene.add(grid);

            // Substation Bay Demarcation Lines
            const lineMat = new THREE.LineBasicMaterial({ color: 0x0ea5e9, transparent: true, opacity: 0.35 });
            for (let x = -30; x <= 30; x += 12) {
                const points = [new THREE.Vector3(x, -2.48, -18), new THREE.Vector3(x, -2.48, 18)];
                const lineGeo = new THREE.BufferGeometry().setFromPoints(points);
                const line = new THREE.Line(lineGeo, lineMat);
                this.scene.add(line);
            }
        }

        createStructuralTruss() {
            const trussGroup = new THREE.Group();
            const steelMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.35 });
            const yellowGuardMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.5, roughness: 0.4 });

            // Main Longitudinal I-Beams (Top & Bottom on both sides)
            const beamGeo = new THREE.BoxGeometry(this.beltLength + 4, 0.35, 0.25);
            for (let z of [-this.beltWidth / 2 - 0.45, this.beltWidth / 2 + 0.45]) {
                const topBeam = new THREE.Mesh(beamGeo, steelMat);
                topBeam.position.set(0, 0.8, z);
                topBeam.castShadow = true;
                trussGroup.add(topBeam);

                const btmBeam = new THREE.Mesh(beamGeo, steelMat);
                btmBeam.position.set(0, -1.8, z);
                btmBeam.castShadow = true;
                trussGroup.add(btmBeam);

                // Diagonal Bracing Struts
                for (let x = -this.beltLength / 2; x < this.beltLength / 2; x += 4.0) {
                    const strutGeo = new THREE.CylinderGeometry(0.08, 0.08, 3.2, 8);
                    const strut = new THREE.Mesh(strutGeo, steelMat);
                    strut.position.set(x + 2.0, -0.5, z);
                    strut.rotation.z = Math.PI / 4;
                    trussGroup.add(strut);
                }
            }

            // Vertical Support Stanchions to Ground
            for (let x of [-14, -7, 0, 7, 14]) {
                for (let z of [-this.beltWidth / 2 - 0.45, this.beltWidth / 2 + 0.45]) {
                    const legGeo = new THREE.BoxGeometry(0.35, 1.8, 0.35);
                    const leg = new THREE.Mesh(legGeo, steelMat);
                    leg.position.set(x, -2.1, z);
                    leg.castShadow = true;
                    trussGroup.add(leg);

                    // Base Plates
                    const basePlateGeo = new THREE.BoxGeometry(0.7, 0.08, 0.7);
                    const basePlate = new THREE.Mesh(basePlateGeo, steelMat);
                    basePlate.position.set(x, -2.46, z);
                    trussGroup.add(basePlate);
                }
            }

            // Troughing Idler Roller Sets (3 Rollers per station along carrying run)
            const rollerMat = new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.85, roughness: 0.2 });
            const rollerCenterGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.6, 16);
            const rollerWingGeo = new THREE.CylinderGeometry(0.18, 0.18, 1.1, 16);

            for (let x = -this.beltLength / 2 + 3; x <= this.beltLength / 2 - 3; x += 3.2) {
                // Center horizontal roller
                const centerRoller = new THREE.Mesh(rollerCenterGeo, rollerMat);
                centerRoller.rotation.x = Math.PI / 2;
                centerRoller.position.set(x, 1.05, 0);
                centerRoller.castShadow = true;
                trussGroup.add(centerRoller);

                // Left wing roller (35 degree tilt)
                const leftWing = new THREE.Mesh(rollerWingGeo, rollerMat);
                leftWing.rotation.x = Math.PI / 2;
                leftWing.rotation.z = -0.45;
                leftWing.position.set(x, 1.35, -1.25);
                trussGroup.add(leftWing);

                // Right wing roller (35 degree tilt)
                const rightWing = new THREE.Mesh(rollerWingGeo, rollerMat);
                rightWing.rotation.x = Math.PI / 2;
                rightWing.rotation.z = 0.45;
                rightWing.position.set(x, 1.35, 1.25);
                trussGroup.add(rightWing);

                // Bottom return idler roller (flat)
                const returnRollerGeo = new THREE.CylinderGeometry(0.16, 0.16, this.beltWidth + 0.4, 16);
                const returnRoller = new THREE.Mesh(returnRollerGeo, rollerMat);
                returnRoller.rotation.x = Math.PI / 2;
                returnRoller.position.set(x + 1.6, -1.55, 0);
                trussGroup.add(returnRoller);
            }

            // Head Drive Drum (Right End)
            const drumGeo = new THREE.CylinderGeometry(this.pulleyRadius, this.pulleyRadius, this.beltWidth + 0.2, 32);
            const drumMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.9, roughness: 0.2 });
            
            this.driveDrum = new THREE.Mesh(drumGeo, drumMat);
            this.driveDrum.rotation.x = Math.PI / 2;
            this.driveDrum.position.set(this.beltLength / 2, 0, 0);
            this.driveDrum.castShadow = true;
            trussGroup.add(this.driveDrum);

            // Tail Take-Up Drum (Left End)
            this.tailDrum = new THREE.Mesh(drumGeo, drumMat);
            this.tailDrum.rotation.x = Math.PI / 2;
            this.tailDrum.position.set(-this.beltLength / 2, 0, 0);
            this.tailDrum.castShadow = true;
            trussGroup.add(this.tailDrum);

            // 75kW Electric Drive Motor & Gearbox Housing
            const motorGeo = new THREE.CylinderGeometry(0.95, 0.95, 2.2, 24);
            const motorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.7, roughness: 0.3 });
            const motor = new THREE.Mesh(motorGeo, motorMat);
            motor.rotation.z = Math.PI / 2;
            motor.position.set(this.beltLength / 2 + 1.2, 0, this.beltWidth / 2 + 1.8);
            trussGroup.add(motor);

            // Drive Shaft
            const shaftGeo = new THREE.CylinderGeometry(0.22, 0.22, 1.8, 16);
            const shaftMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8, metalness: 0.95, roughness: 0.1 });
            const shaft = new THREE.Mesh(shaftGeo, shaftMat);
            shaft.rotation.x = Math.PI / 2;
            shaft.position.set(this.beltLength / 2, 0, this.beltWidth / 2 + 0.9);
            trussGroup.add(shaft);

            // Safety Warning Cage Railings
            const cageGeo = new THREE.BoxGeometry(this.beltLength + 2, 0.8, 0.05);
            for (let z of [-this.beltWidth / 2 - 0.7, this.beltWidth / 2 + 0.7]) {
                const cage = new THREE.Mesh(cageGeo, yellowGuardMat);
                cage.position.set(0, 1.6, z);
                trussGroup.add(cage);
            }

            this.scene.add(trussGroup);
        }

        createBeltLoop() {
            // Generates procedural rubber ribbed conveyor belt texture
            const canvas = document.createElement('canvas');
            canvas.width = 1024;
            canvas.height = 256;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = '#111827';
            ctx.fillRect(0, 0, canvas.width, canvas.height);

            // Rubber grain
            for (let i = 0; i < 6000; i++) {
                const x = Math.random() * canvas.width;
                const y = Math.random() * canvas.height;
                const gray = Math.floor(Math.random() * 25 + 15);
                ctx.fillStyle = `rgb(${gray},${gray},${gray})`;
                ctx.fillRect(x, y, 2, 2);
            }

            // Longitudinal High-Tension Steel Cord Ribs
            for (let y = 16; y < canvas.height; y += 24) {
                ctx.strokeStyle = '#1e293b';
                ctx.lineWidth = 4;
                ctx.beginPath();
                ctx.moveTo(0, y);
                ctx.lineTo(canvas.width, y);
                ctx.stroke();

                ctx.strokeStyle = '#0f172a';
                ctx.lineWidth = 1;
                ctx.beginPath();
                ctx.moveTo(0, y + 2);
                ctx.lineTo(canvas.width, y + 2);
                ctx.stroke();
            }

            this.beltTexture = new THREE.CanvasTexture(canvas);
            this.beltTexture.wrapS = THREE.RepeatWrapping;
            this.beltTexture.wrapT = THREE.RepeatWrapping;
            this.beltTexture.repeat.set(12, 1);

            const beltMat = new THREE.MeshStandardMaterial({
                map: this.beltTexture,
                roughness: 0.75,
                metalness: 0.15
            });

            // Composite geometry for top run, bottom run, and curved pulley ends
            const beltGroup = new THREE.Group();

            // Top carrying strand
            const topStrandGeo = new THREE.PlaneGeometry(this.beltLength, this.beltWidth);
            const topStrand = new THREE.Mesh(topStrandGeo, beltMat);
            topStrand.rotation.x = -Math.PI / 2;
            topStrand.position.set(0, this.pulleyRadius, 0);
            topStrand.receiveShadow = true;
            beltGroup.add(topStrand);

            // Bottom return strand
            const btmStrandGeo = new THREE.PlaneGeometry(this.beltLength, this.beltWidth);
            const btmStrand = new THREE.Mesh(btmStrandGeo, beltMat);
            btmStrand.rotation.x = Math.PI / 2;
            btmStrand.position.set(0, -this.pulleyRadius, 0);
            beltGroup.add(btmStrand);

            // Head Drum Semi-Cylinder Wrap
            const headWrapGeo = new THREE.CylinderGeometry(
                this.pulleyRadius + 0.02,
                this.pulleyRadius + 0.02,
                this.beltWidth,
                32,
                1,
                true,
                -Math.PI / 2,
                Math.PI
            );
            const headWrap = new THREE.Mesh(headWrapGeo, beltMat);
            headWrap.rotation.x = Math.PI / 2;
            headWrap.position.set(this.beltLength / 2, 0, 0);
            beltGroup.add(headWrap);

            // Tail Drum Semi-Cylinder Wrap
            const tailWrapGeo = new THREE.CylinderGeometry(
                this.pulleyRadius + 0.02,
                this.pulleyRadius + 0.02,
                this.beltWidth,
                32,
                1,
                true,
                Math.PI / 2,
                Math.PI
            );
            const tailWrap = new THREE.Mesh(tailWrapGeo, beltMat);
            tailWrap.rotation.x = Math.PI / 2;
            tailWrap.position.set(-this.beltLength / 2, 0, 0);
            beltGroup.add(tailWrap);

            this.beltMesh = beltGroup;
            this.scene.add(beltGroup);
        }

        createVulcanizedSplices() {
            // Distribute 10 vulcanized splices along the perimeter
            const spliceGeo = new THREE.BoxGeometry(0.35, 0.08, this.beltWidth);
            
            for (let i = 0; i < this.jointsCount; i++) {
                const jNum = (i + 1).toString().padStart(3, '0');
                const jId = `J${jNum}`;
                const nfcId = `NFC-J${jNum}`;

                const spliceMat = new THREE.MeshStandardMaterial({
                    color: 0x06b6d4,
                    emissive: 0x06b6d4,
                    emissiveIntensity: 0.4,
                    roughness: 0.3
                });

                const spliceMesh = new THREE.Mesh(spliceGeo, spliceMat);
                spliceMesh.castShadow = true;
                spliceMesh.userData = { jointId: jId, nfcTag: nfcId, index: i, type: "splice" };
                this.scene.add(spliceMesh);
                this.jointMeshes.push(spliceMesh);

                // Floating 3D Text Badge
                const labelSprite = this.createFloatingTextBadge(jId);
                this.scene.add(labelSprite);
                this.jointLabels.push(labelSprite);

                // Store joint traversal perimeter position (0 to totalPerimeter)
                this.joints.push({
                    id: jId,
                    nfc: nfcId,
                    perimeterDistance: (i / this.jointsCount) * this.totalPerimeter,
                    health: 94.0,
                    risk: "NORMAL",
                    defect: null
                });
            }
        }

        createFloatingTextBadge(text) {
            const canvas = document.createElement('canvas');
            canvas.width = 256;
            canvas.height = 96;
            const ctx = canvas.getContext('2d');

            ctx.fillStyle = 'rgba(15, 23, 42, 0.85)';
            ctx.strokeStyle = '#06b6d4';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.roundRect(8, 8, canvas.width - 16, canvas.height - 16, 14);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#38bdf8';
            ctx.font = 'bold 38px "Orbitron", sans-serif';
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(text, canvas.width / 2, canvas.height / 2);

            const texture = new THREE.CanvasTexture(canvas);
            const spriteMat = new THREE.SpriteMaterial({ map: texture, depthTest: false });
            const sprite = new THREE.Sprite(spriteMat);
            sprite.scale.set(2.4, 0.9, 1.0);
            return sprite;
        }

        createScanGantry() {
            const gantryGroup = new THREE.Group();
            const gantryMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.25 });
            const sensorMat = new THREE.MeshStandardMaterial({ color: 0x0284c7, metalness: 0.6, roughness: 0.3 });

            // Overhead Arch at X = 0 (Center of carrying run)
            const postGeo = new THREE.BoxGeometry(0.5, 5.0, 0.5);
            for (let z of [-this.beltWidth / 2 - 0.8, this.beltWidth / 2 + 0.8]) {
                const post = new THREE.Mesh(postGeo, gantryMat);
                post.position.set(0, 1.0, z);
                post.castShadow = true;
                gantryGroup.add(post);
            }

            // Crossbar
            const barGeo = new THREE.BoxGeometry(0.6, 0.6, this.beltWidth + 2.2);
            const crossbar = new THREE.Mesh(barGeo, gantryMat);
            crossbar.position.set(0, 3.4, 0);
            gantryGroup.add(crossbar);

            // High-Speed Camera Housing
            const camGeo = new THREE.BoxGeometry(1.2, 0.8, 1.8);
            const camMesh = new THREE.Mesh(camGeo, sensorMat);
            camMesh.position.set(0, 2.7, 0);
            gantryGroup.add(camMesh);

            // Optical Lens Ring
            const lensGeo = new THREE.CylinderGeometry(0.35, 0.35, 0.3, 16);
            const lensMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.1 });
            const lens = new THREE.Mesh(lensGeo, lensMat);
            lens.position.set(0, 2.2, 0);
            gantryGroup.add(lens);

            // Volumetric Pyramidal Laser Scan Fan
            // Height = 2.2 (from lens at Y=2.2 to belt surface at Y=1.35 + 0.05)
            const laserGeo = new THREE.ConeGeometry(this.beltWidth / 1.5, 1.9, 4, 1, true);
            const laserMat = new THREE.MeshBasicMaterial({
                color: 0x10b981,
                transparent: true,
                opacity: 0.35,
                side: THREE.DoubleSide
            });
            this.laserBeam = new THREE.Mesh(laserGeo, laserMat);
            this.laserBeam.position.set(0, 1.25, 0);
            this.laserBeam.rotation.y = Math.PI / 4;
            gantryGroup.add(this.laserBeam);

            // PointLight at Laser Focal Point
            this.laserLight = new THREE.PointLight(0x10b981, 2.0, 6.0);
            this.laserLight.position.set(0, 1.45, 0);
            gantryGroup.add(this.laserLight);

            // Under-Belt RFID/NFC Antenna Plate
            const nfcPlateGeo = new THREE.BoxGeometry(1.6, 0.15, this.beltWidth - 0.4);
            const nfcMat = new THREE.MeshStandardMaterial({ color: 0x0f172a, emissive: 0x0284c7, emissiveIntensity: 0.2 });
            const nfcPlate = new THREE.Mesh(nfcPlateGeo, nfcMat);
            nfcPlate.position.set(0, this.pulleyRadius - 0.2, 0);
            gantryGroup.add(nfcPlate);

            // Pulsing Electromagnetic NFC Wave Ring
            const ringGeo = new THREE.RingGeometry(0.6, 1.4, 32);
            const ringMat = new THREE.MeshBasicMaterial({ color: 0x38bdf8, transparent: true, opacity: 0.4, side: THREE.DoubleSide });
            this.nfcRing = new THREE.Mesh(ringGeo, ringMat);
            this.nfcRing.rotation.x = -Math.PI / 2;
            this.nfcRing.position.set(0, this.pulleyRadius - 0.1, 0);
            gantryGroup.add(this.nfcRing);

            // 3D Industrial Safety Stack Light Tower (Andon Light)
            this.createSafetyLightTower(gantryGroup);

            this.laserGantry = gantryGroup;
            this.scene.add(gantryGroup);
        }

        createSafetyLightTower(gantryGroup) {
            const andonGroup = new THREE.Group();
            // Mount atop gantry crossbar on operator side
            andonGroup.position.set(0, 3.7, this.beltWidth / 2 + 0.6);

            const poleMat = new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.8, roughness: 0.2 });

            // Steel Support Pole
            const poleGeo = new THREE.CylinderGeometry(0.04, 0.04, 0.7, 12);
            const pole = new THREE.Mesh(poleGeo, poleMat);
            pole.position.y = 0.35;
            andonGroup.add(pole);

            // Base Bracket
            const bGeo = new THREE.CylinderGeometry(0.09, 0.12, 0.08, 16);
            const baseMesh = new THREE.Mesh(bGeo, poleMat);
            baseMesh.position.y = 0.04;
            andonGroup.add(baseMesh);

            // Three Stacked Signal Lamps (Red top, Amber mid, Green bottom)
            const lampGeo = new THREE.CylinderGeometry(0.085, 0.085, 0.16, 16);
            const sepGeo = new THREE.CylinderGeometry(0.095, 0.095, 0.02, 16);

            // 1. Green Lamp (Bottom at Y = 0.80)
            this.matLampGreen = new THREE.MeshStandardMaterial({
                color: 0x10b981,
                emissive: 0x10b981,
                emissiveIntensity: 1.8,
                roughness: 0.2,
                metalness: 0.1,
                transparent: true,
                opacity: 0.95
            });
            this.meshLampGreen = new THREE.Mesh(lampGeo, this.matLampGreen);
            this.meshLampGreen.position.y = 0.80;
            andonGroup.add(this.meshLampGreen);

            const sep1 = new THREE.Mesh(sepGeo, poleMat);
            sep1.position.y = 0.89;
            andonGroup.add(sep1);

            // 2. Amber Lamp (Middle at Y = 1.00)
            this.matLampAmber = new THREE.MeshStandardMaterial({
                color: 0xf59e0b,
                emissive: 0xf59e0b,
                emissiveIntensity: 0.05,
                roughness: 0.2,
                metalness: 0.1,
                transparent: true,
                opacity: 0.95
            });
            this.meshLampAmber = new THREE.Mesh(lampGeo, this.matLampAmber);
            this.meshLampAmber.position.y = 1.00;
            andonGroup.add(this.meshLampAmber);

            const sep2 = new THREE.Mesh(sepGeo, poleMat);
            sep2.position.y = 1.09;
            andonGroup.add(sep2);

            // 3. Red Lamp (Top at Y = 1.20)
            this.matLampRed = new THREE.MeshStandardMaterial({
                color: 0xef4444,
                emissive: 0xef4444,
                emissiveIntensity: 0.05,
                roughness: 0.2,
                metalness: 0.1,
                transparent: true,
                opacity: 0.95
            });
            this.meshLampRed = new THREE.Mesh(lampGeo, this.matLampRed);
            this.meshLampRed.position.y = 1.20;
            andonGroup.add(this.meshLampRed);

            // Top Cap & Dome
            const capGeo = new THREE.CylinderGeometry(0.09, 0.09, 0.04, 16);
            const topCap = new THREE.Mesh(capGeo, poleMat);
            topCap.position.y = 1.30;
            andonGroup.add(topCap);

            // Safety PointLight for ambient colored beacon illumination
            this.safetyPointLight = new THREE.PointLight(0x10b981, 1.8, 8.0);
            this.safetyPointLight.position.set(0, 1.1, 0);
            andonGroup.add(this.safetyPointLight);

            this.safetyLightTower = andonGroup;
            this.safetyState = "NORMAL";
            gantryGroup.add(andonGroup);
        }

        setSafetyLight(state) {
            this.safetyState = state || "NORMAL";
            if (!this.matLampGreen || !this.matLampAmber || !this.matLampRed) return;

            if (this.safetyState === "CRITICAL") {
                // RED STROBE (Joint Rupture / Catastrophic Error)
                this.matLampGreen.emissiveIntensity = 0.05;
                this.matLampAmber.emissiveIntensity = 0.05;
                this.matLampRed.emissiveIntensity = 3.0;
                if (this.safetyPointLight) {
                    this.safetyPointLight.color.setHex(0xef4444);
                    this.safetyPointLight.intensity = 2.5;
                }
                if (this.laserLight) this.laserLight.color.setHex(0xef4444);
                if (this.laserBeam) this.laserBeam.material.color.setHex(0xef4444);
            } else if (this.safetyState === "WARNING") {
                // AMBER (Pre-Alarm / Early Warning)
                this.matLampGreen.emissiveIntensity = 0.05;
                this.matLampAmber.emissiveIntensity = 2.2;
                this.matLampRed.emissiveIntensity = 0.05;
                if (this.safetyPointLight) {
                    this.safetyPointLight.color.setHex(0xf59e0b);
                    this.safetyPointLight.intensity = 1.8;
                }
                if (this.laserLight) this.laserLight.color.setHex(0xf59e0b);
                if (this.laserBeam) this.laserBeam.material.color.setHex(0xf59e0b);
            } else {
                // GREEN (Normal Safe Operation)
                this.matLampGreen.emissiveIntensity = 1.8;
                this.matLampAmber.emissiveIntensity = 0.05;
                this.matLampRed.emissiveIntensity = 0.05;
                if (this.safetyPointLight) {
                    this.safetyPointLight.color.setHex(0x10b981);
                    this.safetyPointLight.intensity = 1.5;
                }
                if (this.laserLight) this.laserLight.color.setHex(0x10b981);
                if (this.laserBeam) this.laserBeam.material.color.setHex(0x10b981);
            }
        }

        createSensorPods() {
            const podGeo = new THREE.CylinderGeometry(0.3, 0.3, 0.45, 16);
            
            // 1. Vibration Sensor on Head Bearing
            const vibMat = new THREE.MeshStandardMaterial({ color: 0x06b6d4, emissive: 0x06b6d4, emissiveIntensity: 0.5 });
            const vibPod = new THREE.Mesh(podGeo, vibMat);
            vibPod.position.set(this.beltLength / 2, 0.8, this.beltWidth / 2 + 0.35);
            vibPod.userData = { type: "sensor", name: "Bearing Accelerometer (MPU6050)", metric: "1.10 g" };
            this.scene.add(vibPod);
            this.sensorPods.push(vibPod);

            // 2. Thermal Pyrometer on Chute
            const tempMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, emissive: 0xf59e0b, emissiveIntensity: 0.5 });
            const tempPod = new THREE.Mesh(podGeo, tempMat);
            tempPod.position.set(-6, 2.5, this.beltWidth / 2 + 0.6);
            tempPod.userData = { type: "sensor", name: "Infrared Thermal Pyrometer", metric: "42.5 °C" };
            this.scene.add(tempPod);
            this.sensorPods.push(tempPod);

            // 3. Acoustic Microphone Pod
            const soundMat = new THREE.MeshStandardMaterial({ color: 0x8b5cf6, emissive: 0x8b5cf6, emissiveIntensity: 0.5 });
            const soundPod = new THREE.Mesh(podGeo, soundMat);
            soundPod.position.set(6, 2.5, -this.beltWidth / 2 - 0.6);
            soundPod.userData = { type: "sensor", name: "Acoustic Resonance Mic", metric: "55 dB" };
            this.scene.add(soundPod);
            this.sensorPods.push(soundPod);
        }

        createDefectVisualizers() {
            this.defectMeshGroup = new THREE.Group();
            this.defectMeshGroup.visible = false;

            // 1. Visible 3D Fracture / Crack Mesh
            const crackGeo = new THREE.BoxGeometry(0.6, 0.15, this.beltWidth * 0.7);
            const crackMat = new THREE.MeshStandardMaterial({
                color: 0xef4444,
                emissive: 0xef4444,
                emissiveIntensity: 0.8,
                roughness: 0.2
            });
            const crack = new THREE.Mesh(crackGeo, crackMat);
            crack.position.set(0, this.pulleyRadius + 0.05, 0);
            this.defectMeshGroup.add(crack);

            // 2. 3D Holographic AI Detection Wireframe Box
            const boxGeo = new THREE.BoxGeometry(1.8, 1.0, this.beltWidth + 0.4);
            const boxEdges = new THREE.EdgesGeometry(boxGeo);
            const boxMat = new THREE.LineBasicMaterial({ color: 0xef4444, linewidth: 2 });
            this.detectionBox = new THREE.LineSegments(boxEdges, boxMat);
            this.detectionBox.position.set(0, this.pulleyRadius + 0.5, 0);
            this.defectMeshGroup.add(this.detectionBox);

            this.scene.add(this.defectMeshGroup);
        }

        createHUDOverlays() {
            // Container for 3D overlay controls
            const hudWrapper = document.createElement('div');
            hudWrapper.className = 'digital-twin-hud-overlay';
            hudWrapper.innerHTML = `
                <div class="dt-top-bar">
                    <div class="dt-title-pill">
                        <span class="dt-live-dot"></span>
                        <strong>3D DIGITAL TWIN</strong>
                        <span class="dt-status-tag" id="dt-status-tag">REALTIME (2.50 m/s)</span>
                    </div>

                    <div class="dt-view-presets">
                        <button class="dt-btn active" data-preset="overview"><i class="fa-solid fa-globe"></i> Overview</button>
                        <button class="dt-btn" data-preset="scanner"><i class="fa-solid fa-camera"></i> Scan Gantry</button>
                        <button class="dt-btn" data-preset="motor"><i class="fa-solid fa-gear"></i> Drive Motor</button>
                        <button class="dt-btn" data-preset="topdown"><i class="fa-solid fa-arrows-up-down"></i> Top-Down</button>
                        <button class="dt-btn dt-btn-track" id="dt-track-btn"><i class="fa-solid fa-crosshairs"></i> Follow Joint</button>
                    </div>

                    <div class="dt-defect-selector-box">
                        <label><i class="fa-solid fa-bolt"></i> Fault Injection:</label>
                        <select id="dt-defect-select">
                            <option value="NORMAL">None (Grade A Normal)</option>
                            <option value="TRANSVERSE_TEAR">💥 Joint Rupture (Transverse Tear)</option>
                            <option value="SEVERE_RUPTURE">⚡ Severe Carcass Rupture</option>
                            <option value="LONGITUDINAL">✂️ Longitudinal Belt Rip</option>
                            <option value="MICRO_CRACK">🔍 Surface Micro-Crack</option>
                            <option value="FRAYING">🧶 Cord Fiber Fraying</option>
                            <option value="EDGE_WEAR">📐 Edge Wear & Scalloping</option>
                            <option value="MISALIGNMENT">↔️ Belt Misalignment</option>
                        </select>
                    </div>
                </div>

                <!-- Defect Alert Banner in 3D Viewport -->
                <div class="dt-alert-banner hidden" id="dt-alert-banner">
                    <div class="dt-alert-icon"><i class="fa-solid fa-triangle-exclamation"></i></div>
                    <div class="dt-alert-content">
                        <div class="dt-alert-title" id="dt-alert-title">CRITICAL DEFECT DETECTED</div>
                        <div class="dt-alert-desc" id="dt-alert-desc">Splice separation located at J004 (Chainage: 48.0m)</div>
                    </div>
                    <button class="dt-alert-close" id="dt-alert-dismiss">&times;</button>
                </div>

                <!-- Floating Raycast Inspector Card -->
                <div class="dt-inspector-card hidden" id="dt-inspector-card">
                    <div class="dt-inspector-header">
                        <h4 id="dt-inspect-title">Joint J001</h4>
                        <button class="dt-inspect-close" id="dt-inspect-close">&times;</button>
                    </div>
                    <div class="dt-inspector-body">
                        <div class="dt-prop-row"><span>NFC UID:</span> <strong id="dt-inspect-nfc">NFC-J001</strong></div>
                        <div class="dt-prop-row"><span>Chainage:</span> <strong id="dt-inspect-chain">12.0m</strong></div>
                        <div class="dt-prop-row"><span>Splice Health:</span> <strong id="dt-inspect-health" class="text-green">94.2%</strong></div>
                        <div class="dt-prop-row"><span>Condition:</span> <span class="badge badge-normal" id="dt-inspect-badge">NORMAL</span></div>
                        <div class="dt-prop-row"><span>Projected RUL:</span> <strong id="dt-inspect-rul">1,200 hrs</strong></div>
                        <div class="dt-prop-row"><span>Plant Bay:</span> <span id="dt-inspect-bay">Substation B - Bay 1</span></div>
                    </div>
                </div>
            `;
            this.container.appendChild(hudWrapper);

            // Wire Buttons
            hudWrapper.querySelectorAll('.dt-btn[data-preset]').forEach(btn => {
                btn.addEventListener('click', () => {
                    hudWrapper.querySelectorAll('.dt-btn[data-preset]').forEach(b => b.classList.remove('active'));
                    btn.classList.add('active');
                    this.followJoint = false;
                    const trackBtn = document.getElementById('dt-track-btn');
                    if (trackBtn) trackBtn.classList.remove('active');
                    this.setCameraPreset(btn.getAttribute('data-preset'));
                });
            });

            const trackBtn = document.getElementById('dt-track-btn');
            if (trackBtn) {
                trackBtn.addEventListener('click', () => {
                    this.followJoint = !this.followJoint;
                    trackBtn.classList.toggle('active', this.followJoint);
                });
            }

            const defectSelect = document.getElementById('dt-defect-select');
            if (defectSelect) {
                defectSelect.addEventListener('change', (e) => {
                    this.simulateDefect(e.target.value);
                });
            }

            const alertDismiss = document.getElementById('dt-alert-dismiss');
            if (alertDismiss) {
                alertDismiss.addEventListener('click', () => {
                    const banner = document.getElementById('dt-alert-banner');
                    if (banner) banner.classList.add('hidden');
                });
            }

            const inspectClose = document.getElementById('dt-inspect-close');
            if (inspectClose) {
                inspectClose.addEventListener('click', () => {
                    const card = document.getElementById('dt-inspector-card');
                    if (card) card.classList.add('hidden');
                });
            }
        }

        setCameraPreset(presetName) {
            const preset = this.cameraPresets[presetName];
            if (!preset || !this.controls) return;
            this.currentPreset = presetName;

            const startPos = this.camera.position.clone();
            const endPos = new THREE.Vector3(...preset.pos);
            const startTarget = this.controls.target.clone();
            const endTarget = new THREE.Vector3(...preset.target);

            let progress = 0;
            const animateTransition = () => {
                progress += 0.05;
                this.camera.position.lerpVectors(startPos, endPos, progress);
                this.controls.target.lerpVectors(startTarget, endTarget, progress);
                if (progress < 1.0) {
                    requestAnimationFrame(animateTransition);
                }
            };
            animateTransition();
        }

        simulateDefect(defectType) {
            if (defectType === "NORMAL") {
                this.activeDefect = null;
                this.defectMeshGroup.visible = false;
                this.setSafetyLight("NORMAL");
                const banner = document.getElementById('dt-alert-banner');
                if (banner) banner.classList.add('hidden');
                return;
            }

            const targetJoint = this.activeJointId || "J004";
            const jIdx = parseInt(targetJoint.replace("J", ""), 10) || 1;
            const chainage = (jIdx * 12.0).toFixed(1);

            let sev = "CRITICAL";
            let desc = "";
            let rul = "24 hrs";

            if (defectType === "MICRO_CRACK" || defectType === "SMALL_CRACKS") {
                sev = "WARNING";
                desc = `Early Warning: Surface micro-crack (<1.5mm) detected on ${targetJoint}.`;
                rul = "480 hrs";
            } else if (defectType === "FRAYING") {
                sev = "WARNING";
                desc = `Early Warning: Cord fiber fraying flagged on ${targetJoint}.`;
                rul = "360 hrs";
            } else if (defectType === "EDGE_WEAR") {
                sev = "WARNING";
                desc = `Lateral wear & edge scalloping on ${targetJoint}. Guide idlers displaced.`;
                rul = "290 hrs";
            } else if (defectType === "TRANSVERSE_TEAR") {
                sev = "CRITICAL";
                desc = `Critical Threat: Cross-belt splice joint rupture on ${targetJoint}! Safety interlock open.`;
                rul = "18 hrs";
            } else if (defectType === "SEVERE_RUPTURE") {
                sev = "CRITICAL";
                desc = `Catastrophic Joint Rupture: Complete carcass separation on ${targetJoint}! Emergency stop activated.`;
                rul = "0.0 hrs";
            } else if (defectType === "LONGITUDINAL" || defectType === "LONGITUDINAL_RUPTURE") {
                sev = "CRITICAL";
                desc = `Emergency Trip: Longitudinal rip slit detected on ${targetJoint}! Rip-Stop engaged.`;
                rul = "2 hrs";
            } else if (defectType === "MISALIGNMENT" || defectType === "BELT_MISALIGNMENT") {
                sev = "WARNING";
                desc = `Tracking offset >25mm on ${targetJoint}. Belt wandering off center.`;
                rul = "24 hrs";
            }

            this.activeDefect = {
                type: defectType,
                jointId: targetJoint,
                severity: sev,
                description: desc,
                chainage: `${chainage}m`,
                rul: rul
            };

            // Highlight in 3D
            this.defectMeshGroup.visible = true;
            const isCrit = (sev === "CRITICAL");
            this.setSafetyLight(isCrit ? "CRITICAL" : "WARNING");

            // Show 3D HUD Alert
            const banner = document.getElementById('dt-alert-banner');
            const bTitle = document.getElementById('dt-alert-title');
            const bDesc = document.getElementById('dt-alert-desc');
            if (banner && bTitle && bDesc) {
                bTitle.innerText = `${sev} DETECTED: ${defectType.replace('_', ' ')}`;
                bDesc.innerText = `${desc} | Chainage: ${chainage}m | RUL: ${rul}`;
                banner.className = `dt-alert-banner ${isCrit ? 'critical' : 'warning'}`;
                banner.classList.remove('hidden');
            }
        }

        update(data) {
            if (!data) return;

            // 1. Speed & Conveyor Status
            this.conveyorStatus = data.conveyor_status || "RUNNING";
            this.beltSpeed = data.belt_speed_mps ?? (this.conveyorStatus === "RUNNING" ? 2.50 : 0.0);

            const statusTag = document.getElementById('dt-status-tag');
            if (statusTag) {
                statusTag.innerText = `${this.conveyorStatus} (${this.beltSpeed.toFixed(2)} m/s)`;
                statusTag.style.color = this.conveyorStatus === "RUNNING" ? "#10b981" : "#ef4444";
            }

            // 2. Active Joint & Health
            if (data.latest_reading) {
                const latest = data.latest_reading;
                this.activeJointId = latest.joint_id;
                this.currentHealth = latest.health_score;
                this.currentRisk = latest.risk_level;

                // Sync Laser & Safety Light with Health when no manual defect override
                if (!this.activeDefect) {
                    if (this.currentHealth >= 80) {
                        this.setSafetyLight("NORMAL");
                    } else if (this.currentHealth >= 50) {
                        this.setSafetyLight("WARNING");
                    } else {
                        this.setSafetyLight("CRITICAL");
                    }
                }
            }

            // 3. Simulated Fault Active
            if (data.active_alert && data.active_alert.severity === "CRITICAL" && !this.activeDefect) {
                this.simulateDefect("TRANSVERSE_TEAR");
            }
        }

        computePositionOnBelt(dist) {
            // Converts linear perimeter distance (0 to totalPerimeter)
            // to exact 3D coordinates along carrying run, drums, and return run
            const L = this.beltLength;
            const R = this.pulleyRadius;
            const curveLen = Math.PI * R;
            let d = ((dist % this.totalPerimeter) + this.totalPerimeter) % this.totalPerimeter;

            // Segment 1: Top Carrying Strand (left to right, -L/2 to +L/2)
            if (d < L) {
                const x = -L / 2 + d;
                return { pos: new THREE.Vector3(x, R + 0.05, 0), rotZ: 0 };
            }
            d -= L;

            // Segment 2: Head Drum Semi-Circle (Right curve, top to bottom)
            if (d < curveLen) {
                const angle = (d / curveLen) * Math.PI; // 0 at top, PI at bottom
                const x = L / 2 + Math.sin(angle) * R;
                const y = Math.cos(angle) * R;
                return { pos: new THREE.Vector3(x, y, 0), rotZ: -angle };
            }
            d -= curveLen;

            // Segment 3: Bottom Return Strand (right to left, +L/2 to -L/2)
            if (d < L) {
                const x = L / 2 - d;
                return { pos: new THREE.Vector3(x, -R - 0.05, 0), rotZ: Math.PI };
            }
            d -= L;

            // Segment 4: Tail Drum Semi-Circle (Left curve, bottom to top)
            const angle = (d / curveLen) * Math.PI;
            const x = -L / 2 - Math.sin(angle) * R;
            const y = -Math.cos(angle) * R;
            return { pos: new THREE.Vector3(x, y, 0), rotZ: Math.PI + angle };
        }

        animate() {
            this.animationFrameId = requestAnimationFrame(() => this.animate());

            const delta = this.clock.getDelta();
            const isRunning = this.conveyorStatus === "RUNNING";

            if (isRunning && this.beltSpeed > 0) {
                const moveDist = this.beltSpeed * delta * 2.2;

                // 1. Scroll Belt Texture UVs
                if (this.beltTexture) {
                    this.beltTexture.offset.x -= (this.beltSpeed * delta * 0.12);
                }

                // 2. Rotate Drive & Tail Pulleys
                if (this.driveDrum && this.tailDrum) {
                    const rotDelta = (this.beltSpeed / this.pulleyRadius) * delta;
                    this.driveDrum.rotation.y += rotDelta;
                    this.tailDrum.rotation.y += rotDelta;
                }

                // 3. Move Vulcanized Splices along belt trajectory
                for (let i = 0; i < this.joints.length; i++) {
                    const j = this.joints[i];
                    j.perimeterDistance = (j.perimeterDistance + moveDist) % this.totalPerimeter;

                    const coord = this.computePositionOnBelt(j.perimeterDistance);
                    const mesh = this.jointMeshes[i];
                    const label = this.jointLabels[i];

                    if (mesh) {
                        mesh.position.copy(coord.pos);
                        mesh.rotation.z = coord.rotZ;

                        // Color splice based on active defect or health condition
                        if (this.activeDefect && this.activeDefect.jointId === j.id) {
                            mesh.material.color.setHex(0xef4444);
                            mesh.material.emissive.setHex(0xef4444);
                            mesh.material.emissiveIntensity = 0.9;
                        } else if (this.activeJointId === j.id) {
                            const h = (typeof this.currentHealth === "number") ? this.currentHealth : 94.0;
                            if (h >= 80) {
                                mesh.material.color.setHex(0x10b981);
                                mesh.material.emissive.setHex(0x10b981);
                                mesh.material.emissiveIntensity = 0.6;
                            } else if (h >= 50) {
                                mesh.material.color.setHex(0xf59e0b);
                                mesh.material.emissive.setHex(0xf59e0b);
                                mesh.material.emissiveIntensity = 0.7;
                            } else {
                                mesh.material.color.setHex(0xef4444);
                                mesh.material.emissive.setHex(0xef4444);
                                mesh.material.emissiveIntensity = 0.9;
                            }
                        } else {
                            mesh.material.color.setHex(0x06b6d4);
                            mesh.material.emissive.setHex(0x06b6d4);
                            mesh.material.emissiveIntensity = 0.3;
                        }
                    }

                    if (label) {
                        label.position.set(coord.pos.x, coord.pos.y + 1.2, coord.pos.z);
                        label.visible = (coord.pos.y > 0); // Only show labels on top strand
                    }

                    // Update Defect Marker position to follow target joint
                    if (this.activeDefect && this.activeDefect.jointId === j.id && this.defectMeshGroup) {
                        this.defectMeshGroup.position.set(coord.pos.x, coord.pos.y - this.pulleyRadius, 0);
                        this.defectMeshGroup.rotation.z = coord.rotZ;
                    }
                }
            }

            // 4. NFC Electromagnetic wave pulse animation
            if (this.nfcRing) {
                const s = 1.0 + 0.15 * Math.sin(this.clock.getElapsedTime() * 4.0);
                this.nfcRing.scale.set(s, s, s);
            }

            // 5. Laser Fan breathing pulse
            if (this.laserBeam) {
                this.laserBeam.material.opacity = 0.3 + 0.12 * Math.sin(this.clock.getElapsedTime() * 6.0);
            }

            // 6. Safety Stack Light (3D Andon Tower) Beacon Animation
            if (this.safetyLightTower) {
                const t = this.clock.getElapsedTime();
                if (this.safetyState === "CRITICAL") {
                    // Rapid emergency strobe on red lamp and pointlight
                    const strobe = (Math.sin(t * 14.0) > 0) ? 3.5 : 0.3;
                    if (this.matLampRed) this.matLampRed.emissiveIntensity = strobe;
                    if (this.safetyPointLight) this.safetyPointLight.intensity = strobe;
                } else if (this.safetyState === "WARNING") {
                    // Pulsing amber lamp
                    const pulse = 1.8 + 0.6 * Math.sin(t * 4.0);
                    if (this.matLampAmber) this.matLampAmber.emissiveIntensity = pulse;
                }
            }

            // 6. Camera Follow-Joint mode
            if (this.followJoint && this.controls) {
                const activeMesh = this.jointMeshes.find(m => m.userData.jointId === this.activeJointId);
                if (activeMesh) {
                    this.controls.target.lerp(new THREE.Vector3(activeMesh.position.x, 1.5, activeMesh.position.z), 0.05);
                }
            }

            if (this.controls) {
                this.controls.update();
            }

            this.renderer.render(this.scene, this.camera);
        }

        onCanvasClick(event) {
            const rect = this.renderer.domElement.getBoundingClientRect();
            this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
            this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

            this.raycaster.setFromCamera(this.mouse, this.camera);
            const intersects = this.raycaster.intersectObjects(this.scene.children, true);

            for (let hit of intersects) {
                let obj = hit.object;
                while (obj && !obj.userData.type && obj.parent) {
                    obj = obj.parent;
                }

                if (obj && obj.userData) {
                    if (obj.userData.type === "splice") {
                        this.showJointInspectionHUD(obj.userData.jointId, obj.userData.nfcTag);
                        return;
                    } else if (obj.userData.type === "sensor") {
                        this.showSensorInspectionHUD(obj.userData.name, obj.userData.metric);
                        return;
                    }
                }
            }
        }

        showJointInspectionHUD(jointId, nfcTag) {
            const card = document.getElementById('dt-inspector-card');
            if (!card) return;

            const jNum = parseInt(jointId.replace("J", ""), 10) || 1;
            const chainage = (jNum * 12.0).toFixed(1);

            document.getElementById('dt-inspect-title').innerText = `Vulcanized Splice ${jointId}`;
            document.getElementById('dt-inspect-nfc').innerText = nfcTag;
            document.getElementById('dt-inspect-chain').innerText = `${chainage} meters`;
            
            const isDefect = this.activeDefect && this.activeDefect.jointId === jointId;
            let healthVal = 95.0;
            if (isDefect) {
                healthVal = 18.5;
            } else if (jointId === this.activeJointId && typeof this.currentHealth === "number") {
                healthVal = this.currentHealth;
            } else {
                healthVal = Math.max(82.0, 96.0 - (jNum % 4) * 2.5);
            }

            const hElem = document.getElementById('dt-inspect-health');
            const bElem = document.getElementById('dt-inspect-badge');

            hElem.innerText = `${healthVal.toFixed(1)}%`;
            if (healthVal < 50 || isDefect) {
                hElem.className = "text-red";
                bElem.innerText = isDefect ? this.activeDefect.type.replace('_', ' ') : "CRITICAL RISK";
                bElem.className = "badge badge-critical";
                document.getElementById('dt-inspect-rul').innerText = isDefect ? this.activeDefect.rul : "18 hrs";
            } else if (healthVal < 80) {
                hElem.className = "text-yellow";
                bElem.innerText = "WARNING RISK";
                bElem.className = "badge badge-warning";
                document.getElementById('dt-inspect-rul').innerText = "360 hrs";
            } else {
                hElem.className = "text-green";
                bElem.innerText = "NORMAL";
                bElem.className = "badge badge-normal";
                document.getElementById('dt-inspect-rul').innerText = "1,200 hrs";
            }

            document.getElementById('dt-inspect-bay').innerText = `Substation B - Bay ${jNum}`;
            card.classList.remove('hidden');
        }

        showSensorInspectionHUD(sensorName, metric) {
            const card = document.getElementById('dt-inspector-card');
            if (!card) return;

            document.getElementById('dt-inspect-title').innerText = sensorName;
            document.getElementById('dt-inspect-nfc').innerText = "TELEMETRY_NODE_24";
            document.getElementById('dt-inspect-chain').innerText = "Fixed Gantry / Drum";
            document.getElementById('dt-inspect-health').innerText = metric;
            document.getElementById('dt-inspect-health').className = "text-cyan";
            document.getElementById('dt-inspect-badge').innerText = "LIVE NODE";
            document.getElementById('dt-inspect-badge').className = "badge badge-normal";
            document.getElementById('dt-inspect-rul').innerText = "Continuous Telemetry";
            document.getElementById('dt-inspect-bay').innerText = "Main Conveyor Line 1";

            card.classList.remove('hidden');
        }

        onWindowResize() {
            if (!this.container || !this.renderer || !this.camera) return;
            const w = this.container.clientWidth;
            const h = this.container.clientHeight || 340;
            this.camera.aspect = w / h;
            this.camera.updateProjectionMatrix();
            this.renderer.setSize(w, h);
        }
    }

    // Expose to window
    window.DigitalTwin3D = DigitalTwin3D;

})(window);
