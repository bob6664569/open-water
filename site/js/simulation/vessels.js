import * as THREE from 'three';

const v3 = (x, y, z) => new THREE.Vector3(x, y, z);

function inertiaFor(mass, length, beam, height) {
  return v3(
    mass * (length * length + height * height) / 12,
    mass * (length * length + beam * beam) / 12,
    mass * (beam * beam + height * height) / 12,
  );
}

function buoyancyPoints(length, beam, pointY, trim = 0) {
  const sections = [
    { z: -0.39, halfBeam: 0.43, weight: 0.29 },
    { z: -0.14, halfBeam: 0.48, weight: 0.28 },
    { z: 0.13, halfBeam: 0.42, weight: 0.26 },
    { z: 0.36, halfBeam: 0.23, weight: 0.17, rise: 0.06 },
  ];
  if (trim) {
    // Positive trim shifts buoyancy toward the bow and settles the stern.
    let total = 0;
    sections.forEach(s => { s.weight *= 1 + trim * s.z; total += s.weight; });
    sections.forEach(s => { s.weight /= total; });
  }
  return sections.flatMap(section => [-1, 1].map(side => ({
    p: v3(
      side * beam * section.halfBeam,
      pointY + (section.rise || 0),
      length * section.z,
    ),
    w: section.weight * 0.5,
  })));
}

function makeSpec(config) {
  const {
    id, label, length, beam, height, mass, restDraft, visualDraft,
    maxThrustFwd, maxThrustRev, maxSpeed, maxSteerDeg,
    dragLong, dragLat, planingLift, planingLiftMax,
    rollStiff, bankGain, bankMax, camera, audio, rig, waterMask,
    materialColors, materialRepairs, reversed,
  } = config;
  const pointY = -(restDraft + config.rideHeight);
  return {
    id, label, length, beam, height, mass, restDraft, visualDraft,
    reversed,
    rideHeight: config.rideHeight,
    inertia: inertiaFor(mass, length, beam, height),
    maxDepthFactor: 3.5,
    buoyPoints: buoyancyPoints(length, beam, pointY, config.trim ?? 0),
    heaveDamp: mass * 5.2,
    slamFactor: 1.75,
    wavePush: config.wavePush ?? 0.58,
    propPos: config.propPos
      ? v3(...config.propPos)
      : v3(0, pointY - restDraft * 0.35, -length * 0.47),
    maxThrustFwd,
    maxThrustRev,
    maxPropSpeed: maxSpeed,
    maxSteerRad: THREE.MathUtils.degToRad(maxSteerDeg),
    dragLong,
    dragLat,
    dragVert: mass * 0.21,
    windage: {
      frontalArea: beam * height * (config.windage?.frontalScale ?? 0.34),
      sideArea: length * height * (config.windage?.sideScale ?? 0.22),
      frontCd: config.windage?.frontCd ?? 0.78,
      sideCd: config.windage?.sideCd ?? 1.02,
      center: v3(
        0,
        config.windage?.height ?? height * 0.38,
        config.windage?.longitudinal ?? -length * 0.035,
      ),
    },
    latDragPos: v3(0, 0, -length * 0.08),
    rudderLift: config.rudderLift,
    planingLift,
    planingLiftMax,
    planingPos: v3(0, 0, -length * 0.08),
    planingCpStart: config.planingCp?.[0] ?? 0.04,
    planingCpEnd: config.planingCp?.[1] ?? -0.1,
    yawDamp: config.yawDamp,
    pitchRollDamp: config.pitchRollDamp,
    pitchStiff: config.pitchStiff ?? 0,
    pitchTargetRad: THREE.MathUtils.degToRad(config.pitchTargetDeg ?? 0),
    bankGain,
    bankMax,
    rollStiff,
    effects: {
      wakeOrigin: v3(0, 0, -length * 0.48),
      prop: v3(0, -restDraft * 0.75, -length * 0.49),
      wakeHalfWidth: beam * 0.34,
      ...config.effects,
    },
    camera: {
      helm: v3(...camera.helm),
      chaseDistance: camera.chaseDistance,
      chaseHeight: camera.chaseHeight,
      helmFov: camera.helmFov,
      topDistance: camera.topDistance,
    },
    audio,
    rig,
    waterMask,
    materialColors,
    materialRepairs,
  };
}

// Shared sea-state response; each vessel only supplies its lens material map.
const NAV_LIGHT_RULES = {
  period: 1.5,
  onFraction: 0.42,
  litRange: [1.3, 2.4],
  stormRange: [3.0, 5.2],
  roughEmissive: 3.2,
  stormEmissive: 8.5,
  haloOpacity: 0.68,
  haloSize: 0.7,
  waterRadius: 2.2,
  waterRough: 0.025,
  waterStorm: 0.08,
};

export const VESSEL_SPECS = {
  boat: makeSpec({
    id: 'boat', label: 'Redline Phantom',
    length: 12.8, beam: 3.0, height: 2.0,
    reversed: true,
    mass: 4300, restDraft: 0.32, visualDraft: 0.62, rideHeight: 0.14,
    trim: 0.9,
    propPos: [0, -0.48, -5.7],
    maxThrustFwd: 120000, maxThrustRev: 18000, maxSpeed: 102.9,
    maxSteerDeg: 18, dragLong: [140, 10.6], dragLat: [1450, 330],
    rudderLift: 245, planingLift: 42, planingLiftMax: 0.66,
    planingCp: [0.055, 0.005],
    yawDamp: [9800, 760, 18400], pitchRollDamp: [220000, 9800],
    pitchStiff: 500000, pitchTargetDeg: 6.5,
    rollStiff: 17200, bankGain: 380, bankMax: 5400, wavePush: 0.08,
    camera: { helm: [0, 1.55, -0.25], chaseDistance: 18, chaseHeight: 1.35, helmFov: 61 },
    audio: {
      bank: 'racer', idleHz: 62, maxHz: 320,
      filterBase: 520, filterRange: 2850, gain: 0.32,
      sampleGain: 0.56, rpmRise: 4.8, rpmFall: 2.4, propGain: 1.28,
      throttleExponent: 0.48,
    },
    effects: {
      roosterTail: {
        origin: [0, -0.26, -6.05], speedStart: 10, speedFull: 55,
        rate: 1.25, height: 1.15, spread: 1.15,
      },
      exhausts: [
        [-0.78, 0.96, -6.04],
        [0.78, 0.96, -6.04],
      ],
    },
    waterMask: {
      // The hull is fully decked; a cockpit mask only protrudes around its
      // exposed stern hardware and is not needed to hide interior water.
      disabled: true,
    },
    rig: {
      telescopingSteering: {
        nodes: ['polySurface71', 'polySurface72'],
        // Hinge at the fixed support (polySurface73), not the blade centre.
        pivot: [0, 9.55, 85.68], axis: 'y', ratio: 1,
        actuators: [
          {
            mesh: 'polySurface70_CABIN_0',
            outer: [-9.904, 10.2, 76.549],
            inner: [-0.842, 10.2, 90.458],
            rodBase: 0.725, rodSplit: 0.78,
          },
          {
            mesh: 'polySurface76_CABIN_0',
            outer: [9.904, 10.2, 76.549],
            inner: [0.842, 10.2, 90.458],
            rodBase: 0.725, rodSplit: 0.78,
          },
        ],
      },
      existingPropellers: [
        {
          mesh: 'polySurface82_CABIN_0', axis: 'z', handedness: 1,
          pivot: [-6.943, 2.809, 81.213],
          selection: { centerZ: [80.8, 81.6] },
        },
        {
          mesh: 'polySurface83_CABIN_0', axis: 'z', handedness: -1,
          pivot: [-6.943, 2.809, 81.213],
          selection: { centerZ: [80.8, 81.6] },
        },
      ],
    },
  }),
  zefiro: makeSpec({
    id: 'zefiro', label: 'Azure Comet', length: 6.5, beam: 2.1, height: 1.45,
    mass: 1250, restDraft: 0.24, visualDraft: 0.52, rideHeight: 0.12,
    maxThrustFwd: 12500, maxThrustRev: 3200, maxSpeed: 21,
    maxSteerDeg: 27, dragLong: [60, 27], dragLat: [500, 125],
    rudderLift: 98, planingLift: 15.5, planingLiftMax: 0.58,
    yawDamp: [2650, 270, 6100], pitchRollDamp: [7300, 2900],
    rollStiff: 5200, bankGain: 130, bankMax: 1650, wavePush: 0.14,
    camera: { helm: [0, 1.42, 0.15], chaseDistance: 12, chaseHeight: 0.8, helmFov: 62 },
    audio: {
      bank: 'zefiro', idleHz: 48, maxHz: 158,
      filterBase: 380, filterRange: 920, gain: 0.2,
      sampleGain: 0.44, rpmRise: 3.0, rpmFall: 1.8, propGain: 0.9,
    },
    effects: {
      sternSpray: {
        strength: 1.2, height: 1.25, spread: 0.95, size: 1.05,
        accelerationBoost: 0.8,
        speedStart: 0.3, speedFull: 0.9,
      },
    },
    waterMask: {
      beamScale: 0.6, bowScale: 0.78, sternScale: 0.86,
      bottom: -0.1, top: 0.32, bowRise: 0.48,
    },
    // The export merges five disconnected body panels into its tinted glass mesh.
    materialRepairs: [
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [-3.8, -3.15], y: [-0.2, 0.4], z: [2.3, 5.3],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [3.15, 3.8], y: [-0.2, 0.4], z: [2.3, 5.3],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [-3.0, -0.8], y: [0.25, 0.85], z: [5.85, 9.6],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [0.8, 3.0], y: [0.25, 0.85], z: [5.85, 9.6],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [-1.3, 1.3], y: [0.2, 0.85], z: [8.7, 10.25],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
    ],
  }),
  'assault-boat': makeSpec({
    id: 'assault-boat', label: 'Blackfin Vanguard', length: 9.5, beam: 4.25, height: 2.05,
    mass: 3400, restDraft: 0.34, visualDraft: 0.76, rideHeight: 0.15,
    trim: 1.0,
    maxThrustFwd: 38000, maxThrustRev: 7200, maxSpeed: 30,
    maxSteerDeg: 25, dragLong: [101, 44], dragLat: [980, 260],
    rudderLift: 185, planingLift: 31, planingLiftMax: 0.54,
    yawDamp: [6900, 620, 14200], pitchRollDamp: [18500, 7600],
    rollStiff: 13800, bankGain: 310, bankMax: 4300, wavePush: 0.1,
    camera: { helm: [0, 1.72, 0.45], chaseDistance: 15.5, chaseHeight: 1.2, helmFov: 60 },
    audio: {
      bank: 'assault-boat', idleHz: 42, maxHz: 142,
      filterBase: 340, filterRange: 1050, gain: 0.25,
      sampleGain: 0.5, rpmRise: 2.65, rpmFall: 1.65, propGain: 1.12,
    },
    effects: {
      sternSpray: {
        strength: 1.65, height: 1.85, spread: 1.2, size: 1.4,
        accelerationBoost: 1.2,
        speedStart: 0.24, speedFull: 0.86,
      },
    },
    waterMask: {
      beamScale: 0.56, bowScale: 0.82, sternScale: 0.68,
      bottom: -0.12, top: 0.34, bowRise: 0.62,
    },
    rig: {
      modelSteer: {
        node: 'Cylinder040', ratio: 1.2, pivotTop: 0.2, pivotForward: 0.08,
      },
      existingPropeller: {
        mesh: 'Cylinder040_M_ShortSword_0', axis: 'z', handedness: 1,
        pivot: [0, -5.2, -187.4],
        selection: {
          centerX: [-12, 12], centerY: [-20, 8], centerZ: [-200, -178],
        },
      },
    },
  }),
  'seadoo-gti': makeSpec({
    id: 'seadoo-gti', label: 'Neon Manta', length: 3.4, beam: 1.25, height: 1.05,
    mass: 385, restDraft: 0.13, visualDraft: 0.27, rideHeight: 0.09,
    maxThrustFwd: 7000, maxThrustRev: 1200, maxSpeed: 26,
    maxSteerDeg: 32, dragLong: [16, 8.7], dragLat: [165, 42],
    rudderLift: 44, planingLift: 4.6, planingLiftMax: 0.72,
    yawDamp: [520, 82, 880], pitchRollDamp: [980, 520],
    rollStiff: 760, bankGain: 43, bankMax: 410, wavePush: 0.2,
    camera: { helm: [0, 0.92, 0.12], chaseDistance: 7.2, chaseHeight: 0.45, helmFov: 64 },
    audio: {
      bank: 'seadoo-gti', idleHz: 68, maxHz: 215,
      filterBase: 520, filterRange: 1450, gain: 0.18,
      sampleGain: 0.4, rpmRise: 2.8, rpmFall: 2.0,
      throttleExponent: 0.82, propGain: 1.35,
    },
    effects: {
      sternSpray: {
        strength: 1.3, height: 1.4, spread: 0.86, size: 0.9,
        accelerationBoost: 1.15,
        speedStart: 0.26, speedFull: 0.88,
      },
    },
    rig: {
      bones: [
        { node: 'Steering_Wheel_Bone_02', axis: 'y', ratio: -1.18 },
        { node: 'Keys_Bone_03', axis: 'z', ratio: -0.58, vibration: 0.025 },
      ],
    },
  }),
  motoryacht: makeSpec({
    id: 'motoryacht', label: 'Ivory Horizon', length: 10.7, beam: 3.35, height: 2.35,
    mass: 6800, restDraft: 0.48, visualDraft: 1.15, rideHeight: 0.12,
    maxThrustFwd: 35500, maxThrustRev: 10500, maxSpeed: 16.5,
    maxSteerDeg: 22, dragLong: [180, 126], dragLat: [1550, 470],
    rudderLift: 250, planingLift: 48, planingLiftMax: 0.44,
    yawDamp: [12800, 920, 23800], pitchRollDamp: [33000, 15600],
    rollStiff: 24800, bankGain: 470, bankMax: 7200, wavePush: 0.075,
    camera: {
      helm: [0, 2.05, 0.65], chaseDistance: 18, chaseHeight: 1.5, helmFov: 58,
    },
    materialColors: { blinn5: 0xa0703f, phongE2: 0xa0703f, lambert1: 0xa0703f },
    audio: {
      bank: 'motoryacht', idleHz: 34, maxHz: 112,
      filterBase: 280, filterRange: 760, gain: 0.28,
      sampleGain: 0.55, rpmRise: 1.65, rpmFall: 1.15, propGain: 0.72,
      idleLevel: 0.16,
    },
    waterMask: {
      beamScale: 0.6, bowScale: 0.86, sternScale: 0.74,
      bottom: -0.12, top: 0.35,
    },
    rig: {
      existingPropellers: [
        {
          mesh: 'transform15_blinn8_0', axis: 'y', handedness: 1, spinRate: 11,
          pivot: [18.79, -204, 9.77],
          selection: {
            centerX: [8, 30], centerY: [-215, -190], centerZ: [2, 18],
          },
        },
        {
          mesh: 'transform15_blinn8_0', axis: 'y', handedness: -1, spinRate: 11,
          pivot: [-18.62, -204, 10.12],
          selection: {
            centerX: [-30, -8], centerY: [-215, -190], centerZ: [2, 18],
          },
        },
        {
          mesh: 'transform15_blinn8_0_1', axis: 'y', handedness: -1, spinRate: 11,
          pivot: [-18.62, -204, 10.12],
          selection: {
            centerX: [-30, -8], centerY: [-215, -190], centerZ: [2, 18],
          },
        },
      ],
      existingFlag: {
        node: 'transform16',
        attachmentStart: [24.55, -79.83, 148.7],
        attachmentEnd: [24.55, -68.49, 140.48],
        down: [0, 0, -1], wind: [0, -0.58675, -0.80977],
        stripes: { lambert5: 0, lambert4: 1, lambert6: 2 },
        colors: { lambert5: 0x0055a4, lambert4: 0xffffff, lambert6: 0xef4135 },
        stripeCount: 3, columns: 8, rows: 12,
        amplitude: 1.7, frequency: 1.05,
      },
      navLights: {
        ...NAV_LIGHT_RULES,
        lenses: { blinn9: 0x3bff66, blinn10: 0xff2a1c },
      },
    },
  }),
  smolbot: makeSpec({
    id: 'smolbot', label: 'Smolbot', length: 6.0, beam: 2.05, height: 1.65,
    mass: 1050, restDraft: 0.25, visualDraft: 1.1, rideHeight: 0.11,
    trim: 0.85,
    maxThrustFwd: 8000, maxThrustRev: 2700, maxSpeed: 15,
    maxSteerDeg: 29, dragLong: [51, 24], dragLat: [430, 108],
    rudderLift: 88, planingLift: 13.2, planingLiftMax: 0.61,
    yawDamp: [2250, 240, 5200], pitchRollDamp: [6100, 2550],
    rollStiff: 4400, bankGain: 112, bankMax: 1420, wavePush: 0.16,
    camera: { helm: [0, 1.5, 0.15], chaseDistance: 11, chaseHeight: 0.8, helmFov: 62 },
    audio: {
      bank: 'zefiro', idleHz: 52, maxHz: 170,
      filterBase: 410, filterRange: 980, gain: 0.2,
      sampleGain: 0.42, rpmRise: 3.2, rpmFall: 1.9, propGain: 0.95,
    },
    effects: {
      sternSpray: {
        strength: 1.1, height: 1.05, spread: 0.88, size: 1,
        accelerationBoost: 0.65,
        speedStart: 0.34, speedFull: 0.92,
      },
    },
    waterMask: {
      beamScale: 0.78, bowScale: 0.72, sternScale: 0.86,
      sternSquare: 0.08, bottom: -0.08, top: 0.28,
    },
    rig: {
      modelSteer: {
        node: 'engine_5', ratio: 1, pivotTop: 0.18, pivotForward: 0.5,
      },
    },
  }),
  ss_minnow_iii: makeSpec({
    id: 'ss_minnow_iii', label: 'S.S. Minnow III',
    length: 11.6, beam: 3.2, height: 3.55,
    mass: 8200, restDraft: 0.66, visualDraft: 0.92, rideHeight: 0.1,
    trim: 0.4,
    propPos: [0, -1.02, -4.3],
    maxThrustFwd: 42000, maxThrustRev: 11500, maxSpeed: 12.5,
    maxSteerDeg: 24, dragLong: [235, 155], dragLat: [1880, 570],
    rudderLift: 295, planingLift: 52, planingLiftMax: 0.39,
    yawDamp: [16400, 1120, 29200], pitchRollDamp: [43000, 20500],
    rollStiff: 31500, bankGain: 560, bankMax: 8700, wavePush: 0.065,
    camera: { helm: [0, 2.55, -0.85], chaseDistance: 20, chaseHeight: 1.8, helmFov: 57 },
    audio: {
      bank: 'motoryacht', idleHz: 31, maxHz: 98,
      filterBase: 250, filterRange: 680, gain: 0.3,
      sampleGain: 0.57, rpmRise: 1.45, rpmFall: 1.05, propGain: 0.68,
      idleLevel: 0.15,
    },
    waterMask: {
      beamScale: 0.72, bowScale: 0.72, sternScale: 0.78,
      bottom: -0.2, top: 0.68,
    },
    rig: {
      nodePropellers: [
        { nodes: ['Object_6'], axis: 'y', handedness: 1, spinRate: 9 },
      ],
      nodeControls: [
        { nodes: ['Object_18', 'Object_23'], axis: 'z', ratio: -2.4 },
      ],
      rotators: [
        {
          mesh: 'Object_43', axis: 'z', rate: 2.5,
          pivot: [0, 1.17, 3.28],
          selection: {
            centerX: [-0.30, 0.30],
            centerY: [0.85, 1.50],
            centerZ: [3.23, 3.40],
          },
        },
      ],
      existingSteerComponents: [
        {
          mesh: 'Object_51', axis: 'z', ratio: 1,
          pivot: [0, 3.624, 0.54],
          selection: {
            centerX: [-0.04, 0.04],
            centerY: [3.5, 3.98],
            centerZ: [0.12, 0.7],
          },
        },
      ],
      navLights: {
        ...NAV_LIGHT_RULES,
        lenses: { acmat_7: 0x3bff66, acmat_8: 0xff2a1c },
      },
    },
  }),
  frickies_yacht: makeSpec({
    id: 'frickies_yacht', label: "Frickie's Yacht",
    // Raw GTA IV dimensions are already meter-scaled; the previous 24 m scale was invalid.
    length: 78, beam: 17.3, height: 24.8,
    reversed: true,
    mass: 2640000, restDraft: 3.4, visualDraft: 3.75, rideHeight: 0.45,
    maxThrustFwd: 1160000, maxThrustRev: 345000, maxSpeed: 10,
    maxSteerDeg: 12, dragLong: [9500, 6650], dragLat: [82400, 24900],
    rudderLift: 29600, planingLift: 1900, planingLiftMax: 0.08,
    yawDamp: [52500000, 3800000, 97700000],
    pitchRollDamp: [136000000, 63700000],
    rollStiff: 31100000, bankGain: 589000, bankMax: 9000000, wavePush: 0.02,
    camera: {
      helm: [0, 13.65, 4.25], chaseDistance: 105, chaseHeight: 8.5,
      helmFov: 52, topDistance: 150,
    },
    audio: {
      bank: 'motoryacht', idleHz: 28, maxHz: 92,
      filterBase: 240, filterRange: 700, gain: 0.30,
      sampleGain: 0.58, rpmRise: 1.4, rpmFall: 1.0, propGain: 0.68,
      idleLevel: 0.16,
    },
    waterMask: {
      beamScale: 0.72, bowScale: 0.9, sternScale: 0.9,
      bottom: -0.9, top: 1.35,
    },
    rig: {
      rotators: [
        {
          mesh: 'e2_cj_big_boat_1_CJ_Boat_1_0', axis: 'z', rate: 1.6,
          weld: 0.08,
          pivot: [0, -11.97, 19.66],
          selection: {
            centerX: [-0.4, 0.4], centerY: [-12.3, -11.6], centerZ: [19.645, 19.71],
          },
        },
      ],
      existingFlag: {
        node: 'e2_cj_big_boat_1_bm_e2_yaughtflag_0',
        attachmentStart: [0.022, -18.4075, 9.0354],
        attachmentEnd: [0.022, -19.2407, 9.897],
        down: [0, 0, -1], wind: [0, -1, 0],
        stripes: { bm_e2_yaughtflag: 0 },
        stripeCount: 1, columns: 12, rows: 9, length: 1.8,
        texture: 'bitcoin',
        amplitude: 0.42, frequency: 1.3,
      },
    },
  }),
  zodiac_boat: makeSpec({
    id: 'zodiac_boat', label: 'Zodiac',
    length: 5.5, beam: 2.05, height: 1.9,
    reversed: true,
    mass: 1050, restDraft: 0.18, visualDraft: 0.6, rideHeight: 0.1, trim: 0.9,
    maxThrustFwd: 10500, maxThrustRev: 2700, maxSpeed: 24,
    maxSteerDeg: 30, dragLong: [43, 19], dragLat: [358, 90],
    rudderLift: 70, planingLift: 11, planingLiftMax: 0.62,
    yawDamp: [2200, 230, 5100], pitchRollDamp: [6100, 2450],
    rollStiff: 4400, bankGain: 110, bankMax: 1400, wavePush: 0.16,
    camera: { helm: [0, 1.35, 0.1], chaseDistance: 10, chaseHeight: 0.7, helmFov: 63 },
    audio: {
      bank: 'zefiro', idleHz: 55, maxHz: 175,
      filterBase: 420, filterRange: 1000, gain: 0.19,
      sampleGain: 0.42, rpmRise: 3.4, rpmFall: 2.0, propGain: 1.0,
    },
    effects: {
      sternSpray: {
        strength: 1.55, height: 1.65, spread: 1.12, size: 1.25,
        accelerationBoost: 1.1,
        speedStart: 0.24, speedFull: 0.86,
      },
    },
    waterMask: {
      beamScale: 0.6, bowScale: 0.86, sternScale: 0.86,
      bottom: -0.06, top: 0.18,
    },
    rig: {
      regionMotors: {
        // Boxes use the shared raw SketchUp coordinate space across material meshes.
        exclude: ['Zodiac_couleur_boudin.'],
        motors: [
          {
            box: { x: [44, 72], y: [-3, 45], z: [5, 92] },
            steer: { pivot: [56, 38, 48], axis: 'z', ratio: 1 },
            prop: { box: { x: [44, 68], y: [-3, 8], z: [5, 34] },
                    pivot: [56, 2, 20], axis: 'y', handedness: 1 },
          },
          {
            box: { x: [86, 114], y: [-3, 45], z: [5, 92] },
            steer: { pivot: [100, 38, 48], axis: 'z', ratio: 1 },
            prop: { box: { x: [89, 113], y: [-3, 8], z: [5, 34] },
                    pivot: [100, 2, 20], axis: 'y', handedness: -1 },
          },
        ],
      },
    },
  }),
};

export function getVesselSpec(name = '') {
  const key = name.toLowerCase().replace(/_(\d+(?:\.\d+)?)(r)?\.glb$/i, '')
    .replace(/\.glb$/i, '');
  return VESSEL_SPECS[key] || VESSEL_SPECS.zefiro;
}
