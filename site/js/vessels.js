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
  // Assiette longitudinale au repos: trim > 0 déplace la flottabilité vers
  // l'avant (relève la proue, enfonce la poupe). trim = 0 -> répartition
  // d'origine (inchangée pour les autres coques).
  if (trim) {
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
    latDragPos: v3(0, 0, -length * 0.08),
    rudderLift: config.rudderLift,
    planingLift,
    planingLiftMax,
    planingPos: v3(0, 0, -length * 0.08),
    yawDamp: config.yawDamp,
    pitchRollDamp: config.pitchRollDamp,
    bankGain,
    bankMax,
    rollStiff,
    effects: {
      wakeOrigin: v3(0, 0, -length * 0.48),
      prop: v3(0, -restDraft * 0.75, -length * 0.49),
      wakeHalfWidth: beam * 0.34,
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

// Règles communes des feux de navigation (clignotement + halo + reflet sur
// l'eau). Chaque bateau ne fournit que sa table `lenses` (matériau -> couleur).
// Le reflet sur l'eau reste volontairement très discret.
const NAV_LIGHT_RULES = {
  period: 1.5,            // durée d'un cycle de clignotement (s)
  onFraction: 0.42,       // part du cycle où le feu est allumé
  litRange: [1.3, 2.4],   // Hs (m): allumage progressif, plein dès "Rough"
  stormRange: [3.0, 5.2], // Hs (m): renfort d'intensité + halo vers "Storm"
  roughEmissive: 3.2,     // pic d'émission en mer formée (bloom net, visible de loin)
  stormEmissive: 8.5,     // pic d'émission en tempête (phare éclatant)
  haloOpacity: 0.68,      // opacité max du halo additif (tempête)
  haloSize: 0.7,          // diamètre du sprite de halo (m)
  // reflet coloré sur la vraie surface de l'eau, cantonné bâbord/tribord
  waterRadius: 2.2,       // rayon de la lueur sur l'eau (m)
  waterRough: 0.025,      // intensité de la lueur d'eau en mer formée
  waterStorm: 0.08,       // intensité en tempête, simple miroitement, très léger
};

export const VESSEL_SPECS = {
  zefiro: makeSpec({
    // Le GLB normalisé à 6,5 m mesure ~2,07 m de large. L'ancien bau de
    // 2,35 m élargissait artificiellement flottabilité, inertie et sillage.
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
    // L'étrave très relevée laissait dépasser le prisme horizontal sous la
    // proue. On raccourcit légèrement l'avant et on fait remonter tout le
    // volume dans la coque sur les derniers mètres.
    waterMask: {
      beamScale: 0.6, bowScale: 0.78, sternScale: 0.86,
      bottom: -0.1, top: 0.32, bowRise: 0.48,
    },
    // L'export GLB a fusionné dans le vitrage teinté 'blinn1' (alphaMode BLEND)
    // cinq panneaux de carrosserie qui apparaissaient donc translucides. On les
    // rend opaques (brun métallisé façon coque) via des boîtes 3D ciblées, dans
    // le repère BRUT du mesh (proue = Z négatif, poupe = Z positif, Y = haut).
    // Tout le reste du mesh (pare-brise, pavillon, vitres latérales, proue)
    // RESTE vitré. Les régions n'englobent qu'un composant chacune, vérifié
    // hors-ligne : aucune ne touche une vraie vitre.
    materialRepairs: [
      // liserés bas de coque (bâbord / tribord), au ras de la flottaison
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [-3.8, -3.15], y: [-0.2, 0.4], z: [2.3, 5.3],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [3.15, 3.8], y: [-0.2, 0.4], z: [2.3, 5.3],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      // côtés de plage arrière (bâbord / tribord)
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [-3.0, -0.8], y: [0.25, 0.85], z: [5.85, 9.6],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [0.8, 3.0], y: [0.25, 0.85], z: [5.85, 9.6],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
      // tableau arrière (jupe / poupe)
      { material: 'blinn1', mesh: 'nurbsToPoly151_blinn1_0',
        x: [-1.3, 1.3], y: [0.2, 0.85], z: [8.7, 10.25],
        color: 0x6b4a30, metalness: 0.6, roughness: 0.32 },
    ],
  }),
  'assault-boat': makeSpec({
    // Le GLB normalisé à 9,5 m fait ~4,26 m de large et ~2,03 m de haut.
    // La fiche étroite précédente concentrait la flottabilité au centre de la
    // coque et sous-estimait fortement son inertie de roulis.
    id: 'assault-boat', label: 'Blackfin Vanguard', length: 9.5, beam: 4.25, height: 2.05,
    mass: 3400, restDraft: 0.34, visualDraft: 0.76, rideHeight: 0.15,
    // La coque piquait ~2° de l'avant (hélice qui ventilait). On avance le
    // centre de poussée pour poser le bateau à plat, poupe bien immergée.
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
    // Le tableau arrière est ouvert entre les flotteurs. La poupe va néanmoins
    // assez loin pour couvrir le fond du cockpit ; l'étrave remonte avec la
    // tonture réelle au lieu de continuer horizontalement sous la proue.
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
    // Reste le plus nerveux de la flotte, mais sans viser les 54 nœuds de
    // l'ancien réglage : cible ~50 nœuds avec une poussée un peu moins brutale.
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
    // Sellerie: les cuirs d'origine du modèle sont bleu-violet/mauve
    // (coussins de bain de soleil, assises) plus un petit liseré magenta.
    // On les repasse en cuir cognac (valeur sRGB, convertie en linéaire
    // par Color.setHex).
    materialColors: { blinn5: 0xa0703f, phongE2: 0xa0703f, lambert1: 0xa0703f },
    audio: {
      bank: 'motoryacht', idleHz: 34, maxHz: 112,
      filterBase: 280, filterRange: 760, gain: 0.28,
      sampleGain: 0.55, rpmRise: 1.65, rpmFall: 1.15, propGain: 0.72,
      idleLevel: 0.16,
    },
    // Le contour par défaut convenait, mais atteignait le tableau arrière :
    // seule la poupe est raccourcie pour rester sous la coque.
    waterMask: {
      beamScale: 0.6, bowScale: 0.86, sternScale: 0.74,
      bottom: -0.12, top: 0.35,
    },
    rig: {
      // Chaque arbre porte DEUX disques 3 pales empilés (design voulu, calés à
      // ~60°). On anime tout le paquet d'un côté en un seul bloc autour de l'axe
      // d'arbre partagé, les deux disques tournent donc ensemble. La sélection
      // couvre toute la plage Y de l'helice (les deux disques). Le côté bâbord
      // est dupliqué sur deux meshes (transform15_blinn8_0 + _0_1) : on anime
      // les deux pour qu'aucune copie ne reste figée.
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
      // Feux de navigation d'origine (petites lentilles à l'étrave), règles
      // communes; seule la table des lentilles change d'un bateau à l'autre.
      navLights: {
        ...NAV_LIGHT_RULES,
        lenses: { blinn9: 0x3bff66, blinn10: 0xff2a1c }, // tribord vert / babord rouge
      },
    },
  }),
  smolbot: makeSpec({
    id: 'smolbot', label: 'Smolbot', length: 6.0, beam: 2.05, height: 1.65,
    // Le point le plus bas du GLB appartient a l'embase du hors-bord, pas a
    // la carene. Il faut donc un tirant visuel plus grand pour immerger le
    // fond de coque d'environ 25 cm tout en gardant le plat-bord hors de l'eau.
    mass: 1050, restDraft: 0.25, visualDraft: 1.1, rideHeight: 0.11,
    // Le centrage du GLB inclut le hors-bord et place donc la carene 28 cm
    // devant l'origine physique. On avance sa flottabilite pour relever
    // l'etrave sans appliquer de rotation visuelle artificielle.
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
    // Le premier masque reprenait presque toute l'enveloppe extérieure et
    // débordait sur les quatre côtés. Volume recentré sur le seul cockpit.
    waterMask: {
      beamScale: 0.78, bowScale: 0.72, sternScale: 0.86,
      sternSquare: 0.08, bottom: -0.08, top: 0.28,
    },
    rig: {
      // Le hors-bord est un groupe autonome dans le GLB. L'helice n'est pas
      // un ilot geometrique distinct, mais toute l'embase suit la barre.
      modelSteer: {
        node: 'engine_5', ratio: 1, pivotTop: 0.18, pivotForward: 0.5,
      },
    },
  }),
  ss_minnow_iii: makeSpec({
    id: 'ss_minnow_iii', label: 'S.S. Minnow III',
    // Le Minnow original est un Wheeler Playmate de 38 pieds. Le GLB est
    // remis a cette longueur plutot que de conserver le fallback de 6,5 m.
    length: 11.6, beam: 3.2, height: 3.55,
    mass: 8200, restDraft: 0.66, visualDraft: 0.92, rideHeight: 0.1,
    // Garde une légère assiette sur l'avant sans sacrifier la réserve de
    // flottabilité du grand cockpit arrière. L'ancien réglage (0.85) chargeait
    // trop la poupe : une crête courte pouvait alors recouvrir tout le pont.
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
    // Le cockpit arrière est ouvert et presque pleine largeur. Le masque suit
    // donc davantage l'intérieur de la coque à la poupe et monte assez haut
    // pour arrêter une crête embarquée, sans déborder au-delà du tableau.
    waterMask: {
      beamScale: 0.72, bowScale: 0.72, sternScale: 0.78,
      bottom: -0.2, top: 0.68,
    },
    rig: {
      // L'export n'a ni os ni noms semantiques. Ces objets ont ete identifies
      // par leur position et leurs dimensions: disque d'helice a la poupe,
      // puis volant et cabochon au poste de pilotage.
      nodePropellers: [
        // Axes dans le repere parent brut du GLB (la racine Sketchfab les
        // convertit ensuite vers Y vertical / Z longitudinal dans la scene).
        { nodes: ['Object_6'], axis: 'y', handedness: 1, spinRate: 9 },
      ],
      nodeControls: [
        { nodes: ['Object_18', 'Object_23'], axis: 'z', ratio: -2.4 },
      ],
      // Antenne radar au sommet de l'arceau : seule la BARRE plate du haut
      // tourne (avec ses deux embouts hexagonaux au bout des bras). Le socle
      // etage, le coin de support, le radome et le fouet restent fixes. Ce sont
      // des ilots de triangles du grand mesh Object_43 ; on ne prend que le
      // sommet (Z local > 3.23, au-dessus des disques du socle a Z~3.14/3.21),
      // en elargissant X/Y pour inclure les embouts diagonaux (X ~ +-0.21).
      // Pivot sur l'axe vertical du socle (X0, Y1.17) ; rate ~24 tr/min.
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
          // Le safran et sa meche sont des ilots de triangles dans le grand
          // mesh Object_51. Les bornes et le pivot sont exprimes dans le
          // repere brut du GLB, avant la rotation de sa racine Sketchfab.
          mesh: 'Object_51', axis: 'z', ratio: 1,
          pivot: [0, 3.624, 0.54],
          selection: {
            centerX: [-0.04, 0.04],
            centerY: [3.5, 3.98],
            centerZ: [0.12, 0.7],
          },
        },
      ],
      // Feux de côté (mât de timonerie): lentilles symétriques bâbord/tribord.
      // Repérées par matériau (les couleurs sont dans les textures, mais chaque
      // lentille a son propre matériau): acmat_7 = vert, acmat_8 = rouge.
      navLights: {
        ...NAV_LIGHT_RULES,
        lenses: { acmat_7: 0x3bff66, acmat_8: 0xff2a1c },
      },
    },
  }),
  frickies_yacht: makeSpec({
    id: 'frickies_yacht', label: "Frickie's Yacht",
    // Le GLB provient du mégayacht de GTA IV et ses dimensions brutes sont déjà
    // cohérentes en mètres (L:l:h = 77,9 : 17,3 : 24,8). L'ancien étalonnage à
    // 24 m réduisait son hélipad à ~4 m, plus petit que le rotor du moindre
    // hélicoptère. À 78 m, la plateforme retrouve un diamètre crédible de
    // 13-16 m et les éléments d'aménagement une taille humaine.
    length: 78, beam: 17.3, height: 24.8,
    // Charge proue vers l'arrière -> retourné de 180° (confirmé en jeu).
    reversed: true,
    // Déplacement géométriquement extrapolé depuis la coque de 24 m (~2 640 t).
    // La poussée et les traînées suivent surtout la surface mouillée, tandis que
    // l'inertie croît avec masse × longueur² : beaucoup d'erre, barre lente et
    // aucun comportement de vedette planante.
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
      // Réutilise la banque diesel de l'Ivory Horizon, calée plus grave encore
      // (grosse machine lente). Cohérent avec le pattern smolbot/minnow.
      bank: 'motoryacht', idleHz: 28, maxHz: 92,
      filterBase: 240, filterRange: 700, gain: 0.30,
      sampleGain: 0.58, rpmRise: 1.4, rpmFall: 1.0, propGain: 0.68,
      idleLevel: 0.16,
    },
    waterMask: {
      beamScale: 0.72, bowScale: 0.9, sternScale: 0.9,
      bottom: -0.9, top: 1.35,
    },
    // Meshes découpés 1:1 par matériau (43/43) : le vitrage teinté est un mesh
    // dédié, aucun panneau de coque n'y est fusionné -> pas de materialRepairs
    // à faire (contrairement au Zefiro). Hélice/safran non modélisés en îlots.
    rig: {
      // Barre d'antenne (radar) au mât : la PLANCHE plate en haut du mât
      // (pavé 1,6×1,2×0,07 brut, centre 0/-11,97/19,66). Le modèle a chaque
      // face en quad indépendant, donc on SOUDE (weld) pour reformer la planche
      // en UN composant, isolable du socle et du bras (composants soudés
      // distincts). La boîte cible juste le CENTRE de la planche ; tout le
      // composant soudé suit. Elle tourne autour de la verticale (axe Z brut).
      rotators: [
        {
          mesh: 'e2_cj_big_boat_1_CJ_Boat_1_0', axis: 'z', rate: 1.6,
          weld: 0.08,
          pivot: [0, -11.97, 19.66],
          // La planche (composant soudé, centre Z 19,66) et son AXE/poteau
          // vertical (centre Z 19,63) ne diffèrent qu'en Z. On borne centerZ à
          // [19,645..] pour prendre la planche et laisser l'axe fixe (le plank
          // tourne autour de l'axe, comme voulu).
          selection: {
            centerX: [-0.4, 0.4], centerY: [-12.3, -11.6], centerZ: [19.645, 19.71],
          },
        },
      ],
      // Pavillon de poupe (mesh dédié bm_e2_yaughtflag, un seul matériau texturé).
      // Le guindant suit la hampe inclinée d'origine (bord UV U=0), au lieu de
      // l'ancienne ligne verticale qui agrandissait et décollait le tissu.
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
    // Petit semi-rigide (RIB) à console centrale. Proportions relevées sur le
    // GLB brut SketchUp (L:l:h = 413 : 155 : 141) : à 5,5 m -> ~2,05 m de bau,
    // ~1,9 m de haut (jusqu'au sommet de la console/arceau). Coque planante
    // légère et vive, calquée sur le Zefiro réduit.
    length: 5.5, beam: 2.05, height: 1.9,
    // Le GLB pointe proue vers +Z une fois l'axe long aligné : il charge donc
    // à l'envers (proue vers la caméra). On le retourne de 180° comme le
    // motoryacht, mais via le spec (nom de fichier laissé propre, sans _long).
    reversed: true,
    // Enfoncé (hélices immergées, poupe posée) + assiette sur l'arrière
    // (trim>0 enfonce la poupe) car il flottait cul haut. 0,74 embarquait trop
    // d'eau -> remonté à 0,6 : hélices encore immergées, plus de franc-bord.
    mass: 1050, restDraft: 0.18, visualDraft: 0.6, rideHeight: 0.1, trim: 0.9,
    maxThrustFwd: 10500, maxThrustRev: 2700, maxSpeed: 24,
    maxSteerDeg: 30, dragLong: [43, 19], dragLat: [358, 90],
    rudderLift: 70, planingLift: 11, planingLiftMax: 0.62,
    yawDamp: [2200, 230, 5100], pitchRollDamp: [6100, 2450],
    rollStiff: 4400, bankGain: 110, bankMax: 1400, wavePush: 0.16,
    camera: { helm: [0, 1.35, 0.1], chaseDistance: 10, chaseHeight: 0.7, helmFov: 63 },
    audio: {
      // Hors-bord essence : réutilise la banque du Zefiro comme le Smolbot.
      bank: 'zefiro', idleHz: 55, maxHz: 175,
      filterBase: 420, filterRange: 1000, gain: 0.19,
      sampleGain: 0.42, rpmRise: 3.4, rpmFall: 2.0, propGain: 1.0,
    },
    // Le contour horizontal par défaut est déjà juste ; seul le volume
    // vertical est aminci pour ne plus apparaître au-dessus des boudins.
    waterMask: {
      beamScale: 0.6, bowScale: 0.86, sternScale: 0.86,
      bottom: -0.06, top: 0.18,
    },
    // Deux hors-bord existants modélisés (export SketchUp fragmenté par
    // matériau : capot = gris_fonc, hélice = Beige_sombre, embase = Gris/NEUTRE).
    // Boîtes en coords BRUTES calibrées visuellement (repère commun à tous les
    // meshes) ; le partage bâbord/tribord par la coordonnée X écarte le tableau
    // arrière centré, le tube est exclu par matériau. Chaque moteur pivote
    // autour de la verticale (axe Z brut) avec la barre ; son hélice tourne
    // autour de l'arbre (axe Y brut) et suit le moteur.
    rig: {
      regionMotors: {
        exclude: ['Zodiac_couleur_boudin.'],
        motors: [
          { // tribord (X brut ~60)
            // Y jusqu'à 45 pour inclure aussi la PLAQUE de fixation au tableau
            // (îlot Gris à Y~33-43, X~57-61) : elle fait partie du moteur et doit
            // tourner avec. La banquette centrale (X~77,7) reste hors boîte.
            // Pivot AU NIVEAU DE LA PLAQUE (Y~38), pas à l'embase (Y~8) : le
            // moteur pivote autour du tableau et c'est l'hélice qui balaie, pas
            // le capot.
            box: { x: [44, 72], y: [-3, 45], z: [5, 92] },
            steer: { pivot: [56, 38, 48], axis: 'z', ratio: 1 },
            prop: { box: { x: [44, 68], y: [-3, 8], z: [5, 34] },
                    pivot: [56, 2, 20], axis: 'y', handedness: 1 },
          },
          { // bâbord (X brut ~102)
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
