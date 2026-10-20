import * as THREE from 'three';

export function createEchoScene(canvas) {
  const platformTop = -0.025;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#070b12');
  scene.fog = new THREE.Fog('#070b12', 9, 24);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    0.1,
    100,
  );
  const cameraOffset = new THREE.Vector3(4.5, 3.2, 6.5);
  camera.position.copy(cameraOffset);
  camera.lookAt(0, 0.8, 0);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.15;

  // Soft ambient light reveals the scene while the point light gives the crystal its glow.
  scene.add(new THREE.HemisphereLight('#b6d8ff', '#11131e', 1.5));

  const keyLight = new THREE.DirectionalLight('#d4e8ff', 2.2);
  keyLight.position.set(4, 7, 5);
  scene.add(keyLight);

  const crystalLight = new THREE.PointLight('#18e8ff', 18, 7);
  crystalLight.position.set(0, 1.5, 0);
  scene.add(crystalLight);

  // A small, fixed star field adds distance without ongoing particle simulation.
  const starPositions = new Float32Array(360 * 3);
  for (let index = 0; index < 360; index += 1) {
    const angle = Math.random() * Math.PI * 2;
    const radius = 11 + Math.random() * 18;
    starPositions[index * 3] = Math.cos(angle) * radius;
    starPositions[index * 3 + 1] = -2 + Math.random() * 16;
    starPositions[index * 3 + 2] = Math.sin(angle) * radius - 4;
  }
  const starGeometry = new THREE.BufferGeometry();
  starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
  const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
    color: '#75c9e8', size: 0.055, transparent: true, opacity: 0.62,
    sizeAttenuation: true, depthWrite: false,
  }));
  scene.add(stars);

  // Static, low-poly shards make the empty space feel like a broken memory field.
  const debris = new THREE.Group();
  const debrisMaterial = new THREE.MeshStandardMaterial({
    color: '#24445a', emissive: '#073344', emissiveIntensity: 0.55,
    metalness: 0.72, roughness: 0.4,
  });
  for (let index = 0; index < 14; index += 1) {
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.12 + (index % 3) * 0.045, 0), debrisMaterial);
    const angle = index * 2.399;
    const radius = 3.3 + (index % 4) * 0.62;
    shard.position.set(Math.cos(angle) * radius, -0.85 + (index % 5) * 0.52, -3.6 + Math.sin(angle) * radius);
    shard.userData.baseY = shard.position.y;
    shard.rotation.set(index * 0.4, index * 0.7, index * 0.2);
    debris.add(shard);
  }
  scene.add(debris);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(2.2, 2.45, 0.35, 8, 1),
    new THREE.MeshStandardMaterial({
      color: '#182536',
      metalness: 0.72,
      roughness: 0.34,
    }),
  );
  platform.position.y = -0.2;
  scene.add(platform);

  const platformEdge = new THREE.Mesh(
    new THREE.TorusGeometry(2.18, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({ color: '#16cfe3' }),
  );
  platformEdge.rotation.x = Math.PI / 2;
  platformEdge.position.y = -0.015;
  scene.add(platformEdge);
  const platformUnderlight = new THREE.Mesh(
    new THREE.TorusGeometry(1.72, 0.018, 6, 48),
    new THREE.MeshBasicMaterial({ color: '#168ca5', transparent: true, opacity: 0.55 }),
  );
  platformUnderlight.rotation.x = Math.PI / 2;
  platformUnderlight.position.y = -0.39;
  scene.add(platformUnderlight);

  // A second island gives the puzzle a clear destination on the other side of the gap.
  const exitPlatformZ = -8.4;
  const exitPlatform = new THREE.Mesh(
    new THREE.CylinderGeometry(2.3, 2.5, 0.35, 8, 1),
    new THREE.MeshStandardMaterial({
      color: '#182536',
      metalness: 0.72,
      roughness: 0.34,
    }),
  );
  exitPlatform.position.set(0, -0.2, exitPlatformZ);
  scene.add(exitPlatform);

  const exitPlatformEdge = new THREE.Mesh(
    new THREE.TorusGeometry(2.28, 0.035, 8, 64),
    new THREE.MeshBasicMaterial({ color: '#16cfe3' }),
  );
  exitPlatformEdge.rotation.x = Math.PI / 2;
  exitPlatformEdge.position.set(0, -0.015, exitPlatformZ);
  scene.add(exitPlatformEdge);
  const exitUnderlight = platformUnderlight.clone();
  exitUnderlight.position.set(0, -0.39, exitPlatformZ);
  scene.add(exitUnderlight);

  // The bridge is built from separate panels so they can rise into place in sequence.
  const bridge = new THREE.Group();
  const bridgeLength = 5.4;
  const bridgeCenterZ = -3.9;
  const bridgePanelCount = 6;
  const bridgePanels = [];
  const bridgeMaterial = new THREE.MeshStandardMaterial({
    color: '#143242',
    emissive: '#00bcd4',
    emissiveIntensity: 0.9,
    metalness: 0.65,
    roughness: 0.3,
  });

  for (let index = 0; index < bridgePanelCount; index += 1) {
    const panel = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.22, 0.84),
      bridgeMaterial,
    );
    const panelZ = bridgeCenterZ + bridgeLength / 2
      - (index + 0.5) * (bridgeLength / bridgePanelCount);
    panel.position.set(0, -1.8, panelZ);
    bridge.add(panel);
    bridgePanels.push(panel);
  }
  scene.add(bridge);

  // The switch sits near the first platform's bridge entrance.
  const switchPosition = new THREE.Vector3(-0.55, -0.025, -1.25);
  const puzzleSwitch = new THREE.Group();
  puzzleSwitch.position.copy(switchPosition);

  const switchBase = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.4, 0.16, 12),
    new THREE.MeshStandardMaterial({ color: '#253b4c', metalness: 0.8, roughness: 0.25 }),
  );
  switchBase.position.y = 0.08;
  puzzleSwitch.add(switchBase);

  const switchButtonMaterial = new THREE.MeshStandardMaterial({
    color: '#72f7ff',
    emissive: '#00dff5',
    emissiveIntensity: 2.2,
    metalness: 0.25,
    roughness: 0.18,
  });
  const switchButton = new THREE.Mesh(
    new THREE.CylinderGeometry(0.24, 0.3, 0.18, 12),
    switchButtonMaterial,
  );
  switchButton.position.y = 0.23;
  puzzleSwitch.add(switchButton);

  const switchRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.3, 0.025, 8, 32),
    new THREE.MeshBasicMaterial({ color: '#42f5ff' }),
  );
  switchRing.rotation.x = Math.PI / 2;
  switchRing.position.y = 0.18;
  puzzleSwitch.add(switchRing);
  scene.add(puzzleSwitch);

  // The portal faces the bridge so it is easy to spot when the player arrives.
  const portalPosition = new THREE.Vector3(0, 0.82, -9.45);
  const portal = new THREE.Group();
  portal.position.copy(portalPosition);
  const portalRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.68, 0.075, 12, 48),
    new THREE.MeshStandardMaterial({
      color: '#7ffaff',
      emissive: '#00dff5',
      emissiveIntensity: 3,
      metalness: 0.25,
      roughness: 0.16,
    }),
  );
  portal.add(portalRing);
  const portalCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.6, 40),
    new THREE.MeshBasicMaterial({ color: '#11d9ef', transparent: true, opacity: 0.2 }),
  );
  portalCore.position.z = -0.025;
  portal.add(portalCore);
  const portalLight = new THREE.PointLight('#18e8ff', 12, 5);
  portalLight.position.set(0, 0, 0.5);
  portal.add(portalLight);
  scene.add(portal);
  const portalFloorLight = new THREE.PointLight('#40ddff', 5, 3.5);
  portalFloorLight.position.set(0, 0.2, -9.05);
  scene.add(portalFloorLight);

  // Level 2 lives in its own distant pocket so Level 1 stays intact and hidden in the fog.
  const levelTwo = new THREE.Group();
  levelTwo.visible = false;
  const levelTwoX = 24;
  const levelTwoPlatformMaterial = new THREE.MeshStandardMaterial({
    color: '#20223b', metalness: 0.76, roughness: 0.3,
  });
  const levelTwoEdgeMaterial = new THREE.MeshBasicMaterial({ color: '#a34eff' });
  const levelTwoPlatforms = [
    { x: levelTwoX, z: 0, radius: 1.72, size: 2.15 },
    { x: levelTwoX, z: -3.15, radius: 0.98, size: 1.2 },
    { x: levelTwoX, z: -6.2, radius: 1.58, size: 2.0 },
    { x: levelTwoX, z: -10.7, radius: 1.78, size: 2.2 },
  ];
  for (const island of levelTwoPlatforms) {
    const islandMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(island.size, island.size + 0.2, 0.35, 8),
      levelTwoPlatformMaterial,
    );
    islandMesh.position.set(island.x, -0.2, island.z);
    levelTwo.add(islandMesh);
    const islandEdge = new THREE.Mesh(
      new THREE.TorusGeometry(island.size - 0.03, 0.035, 8, 48),
      levelTwoEdgeMaterial,
    );
    islandEdge.rotation.x = Math.PI / 2;
    islandEdge.position.set(island.x, -0.015, island.z);
    levelTwo.add(islandEdge);
  }

  function makeLevelTwoSwitch(position, color) {
    const root = new THREE.Group();
    root.position.set(position.x, platformTop, position.z);
    const base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.34, 0.4, 0.16, 12),
      new THREE.MeshStandardMaterial({ color: '#302a45', metalness: 0.8, roughness: 0.25 }),
    );
    base.position.y = 0.08;
    root.add(base);
    const material = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 2.2,
      metalness: 0.25, roughness: 0.18,
    });
    const button = new THREE.Mesh(new THREE.CylinderGeometry(0.24, 0.3, 0.18, 12), material);
    button.position.y = 0.23;
    root.add(button);
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.3, 0.025, 8, 32),
      new THREE.MeshBasicMaterial({ color }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.18;
    root.add(ring);
    levelTwo.add(root);
    return { root, position: new THREE.Vector3(position.x, platformTop, position.z), button, material, ring };
  }

  const levelTwoSwitches = [
    makeLevelTwoSwitch({ x: levelTwoX, z: -0.55 }, '#46efff'),
    makeLevelTwoSwitch({ x: levelTwoX, z: -6.2 }, '#bd79ff'),
  ];
  const levelTwoBridgeCenterZ = -8.4;
  const levelTwoBridgeLength = 1.8;
  const levelTwoBridgePanels = [];
  const levelTwoBridgeMaterial = new THREE.MeshStandardMaterial({
    color: '#302449', emissive: '#a24aff', emissiveIntensity: 1.1,
    metalness: 0.7, roughness: 0.28,
  });
  for (let index = 0; index < 4; index += 1) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 0.48), levelTwoBridgeMaterial);
    panel.position.set(levelTwoX, -1.8, levelTwoBridgeCenterZ + levelTwoBridgeLength / 2
      - (index + 0.5) * (levelTwoBridgeLength / 4));
    levelTwo.add(panel);
    levelTwoBridgePanels.push(panel);
  }
  const levelTwoPortalPosition = new THREE.Vector3(levelTwoX, 0.82, -11.35);
  const levelTwoPortal = new THREE.Group();
  levelTwoPortal.position.copy(levelTwoPortalPosition);
  const levelTwoPortalRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.08, 12, 48),
    new THREE.MeshStandardMaterial({
      color: '#d6b2ff', emissive: '#9c42ff', emissiveIntensity: 3.2,
      metalness: 0.25, roughness: 0.16,
    }),
  );
  levelTwoPortal.add(levelTwoPortalRing);
  const levelTwoPortalCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.63, 40),
    new THREE.MeshBasicMaterial({ color: '#a64cff', transparent: true, opacity: 0.22 }),
  );
  levelTwoPortalCore.position.z = -0.025;
  levelTwoPortal.add(levelTwoPortalCore);
  levelTwoPortal.add(new THREE.PointLight('#b76cff', 13, 5));
  levelTwo.add(levelTwoPortal);
  const levelTwoPortalLight = new THREE.PointLight('#b76cff', 5, 3.5);
  levelTwoPortalLight.position.set(levelTwoX, 0.2, -10.95);
  levelTwo.add(levelTwoPortalLight);
  scene.add(levelTwo);

  // Level 3 is an echo-calibration route: three resonators must be touched in order.
  const levelThree = new THREE.Group();
  levelThree.visible = false;
  const levelThreeX = 48;
  const levelThreePlatformMaterial = new THREE.MeshStandardMaterial({
    color: '#182b35', metalness: 0.74, roughness: 0.32,
  });
  const levelThreeEdgeMaterial = new THREE.MeshBasicMaterial({ color: '#ffc16a' });
  const levelThreePlatforms = [
    { x: levelThreeX, z: 0, radius: 1.72, size: 2.15 },
    { x: levelThreeX, z: -3.2, radius: 0.98, size: 1.2 },
    { x: levelThreeX, z: -6.4, radius: 0.98, size: 1.2 },
    { x: levelThreeX, z: -10.7, radius: 1.78, size: 2.2 },
  ];
  for (const island of levelThreePlatforms) {
    const islandMesh = new THREE.Mesh(
      new THREE.CylinderGeometry(island.size, island.size + 0.2, 0.35, 8),
      levelThreePlatformMaterial,
    );
    islandMesh.position.set(island.x, -0.2, island.z);
    levelThree.add(islandMesh);
    const islandEdge = new THREE.Mesh(
      new THREE.TorusGeometry(island.size - 0.03, 0.035, 8, 48),
      levelThreeEdgeMaterial,
    );
    islandEdge.rotation.x = Math.PI / 2;
    islandEdge.position.set(island.x, -0.015, island.z);
    levelThree.add(islandEdge);
  }

  const levelThreeRelayColors = ['#46efff', '#ffc16a', '#bd79ff'];
  const levelThreeRelays = levelThreeRelayColors.map((color, index) => {
    const relayZ = [-0.55, -3.2, -6.4][index];
    const root = new THREE.Group();
    root.position.set(levelThreeX, platformTop, relayZ);
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.025, 8, 40),
      new THREE.MeshBasicMaterial({ color }),
    );
    halo.rotation.x = Math.PI / 2;
    halo.position.y = 0.12;
    root.add(halo);
    const material = new THREE.MeshStandardMaterial({
      color, emissive: color, emissiveIntensity: 1.8,
      metalness: 0.28, roughness: 0.18, flatShading: true,
    });
    const shard = new THREE.Mesh(new THREE.OctahedronGeometry(0.25, 0), material);
    shard.position.y = 0.48;
    root.add(shard);
    const anchor = new THREE.Mesh(
      new THREE.CylinderGeometry(0.2, 0.27, 0.12, 10),
      new THREE.MeshStandardMaterial({ color: '#283b49', metalness: 0.8, roughness: 0.3 }),
    );
    anchor.position.y = 0.07;
    root.add(anchor);
    levelThree.add(root);
    return {
      root,
      position: new THREE.Vector3(levelThreeX, platformTop, relayZ),
      material,
      shard,
      halo,
      color,
    };
  });

  const levelThreeBridgeCenterZ = -8.15;
  const levelThreeBridgeLength = 2.6;
  const levelThreeBridgePanels = [];
  const levelThreeBridgeMaterial = new THREE.MeshStandardMaterial({
    color: '#303529', emissive: '#ffc16a', emissiveIntensity: 1,
    metalness: 0.68, roughness: 0.3,
  });
  for (let index = 0; index < 4; index += 1) {
    const panel = new THREE.Mesh(new THREE.BoxGeometry(2.1, 0.2, 0.5), levelThreeBridgeMaterial);
    panel.position.set(levelThreeX, -1.8, levelThreeBridgeCenterZ + levelThreeBridgeLength / 2
      - (index + 0.5) * (levelThreeBridgeLength / 4));
    levelThree.add(panel);
    levelThreeBridgePanels.push(panel);
  }

  const levelThreePortalPosition = new THREE.Vector3(levelThreeX, 0.82, -11.35);
  const levelThreePortal = new THREE.Group();
  levelThreePortal.position.copy(levelThreePortalPosition);
  const levelThreePortalRing = new THREE.Mesh(
    new THREE.TorusGeometry(0.72, 0.08, 12, 48),
    new THREE.MeshStandardMaterial({
      color: '#ffe0aa', emissive: '#ffb84a', emissiveIntensity: 3,
      metalness: 0.25, roughness: 0.16,
    }),
  );
  levelThreePortal.add(levelThreePortalRing);
  const levelThreePortalCore = new THREE.Mesh(
    new THREE.CircleGeometry(0.63, 40),
    new THREE.MeshBasicMaterial({ color: '#ffb84a', transparent: true, opacity: 0.22 }),
  );
  levelThreePortalCore.position.z = -0.025;
  levelThreePortal.add(levelThreePortalCore);
  levelThreePortal.add(new THREE.PointLight('#ffc16a', 13, 5));
  levelThree.add(levelThreePortal);
  const levelThreePortalLight = new THREE.PointLight('#ffc16a', 5, 3.5);
  levelThreePortalLight.position.set(levelThreeX, 0.2, -10.95);
  levelThree.add(levelThreePortalLight);
  scene.add(levelThree);

  const crystal = new THREE.Mesh(
    new THREE.OctahedronGeometry(0.58, 0),
    new THREE.MeshStandardMaterial({
      color: '#8afaff',
      emissive: '#00d9f5',
      emissiveIntensity: 2.4,
      metalness: 0.3,
      roughness: 0.16,
      flatShading: true,
    }),
  );
  crystal.position.y = 1.25;
  scene.add(crystal);

  // The capsule's bottom rests on the platform. Its group position is its center.
  const playerHeight = 1.25;
  const playerRadius = 0.28;
  const player = new THREE.Mesh(
    new THREE.CapsuleGeometry(playerRadius, playerHeight - playerRadius * 2, 6, 12),
    new THREE.MeshStandardMaterial({
      color: '#d8f4ff',
      emissive: '#126b86',
      emissiveIntensity: 0.45,
      metalness: 0.38,
      roughness: 0.28,
    }),
  );
  player.position.set(0.95, -0.025 + playerHeight / 2, 1.05);
  scene.add(player);

  // Small cyan visor makes the player's facing direction easy to read.
  const visor = new THREE.Mesh(
    new THREE.BoxGeometry(0.3, 0.12, 0.08),
    new THREE.MeshBasicMaterial({ color: '#38efff' }),
  );
  visor.position.set(0, 0.2, 0.25);
  player.add(visor);

  // Each remote slot gets its own mesh so every room member is visible.
  const remoteColors = ['#54dfff', '#ffb86b', '#bc91ff', '#80ed99', '#ff7b9c', '#ffe66d', '#79a7ff', '#ff9f6e'];
  const remotePlayers = remoteColors.map((color) => {
    const remotePlayer = player.clone();
    remotePlayer.material = new THREE.MeshStandardMaterial({
      color,
      emissive: color,
      emissiveIntensity: 0.42,
      metalness: 0.38,
      roughness: 0.28,
    });
    remotePlayer.children[0].material = new THREE.MeshBasicMaterial({ color: '#e9ffff' });
    remotePlayer.visible = false;
    scene.add(remotePlayer);
    return remotePlayer;
  });

  return {
    renderer,
    scene,
    camera,
    crystal,
    player,
    remotePlayers,
    cameraOffset,
    platformTop,
    platformRadius: 1.86,
    playerHeight,
    bridgePanels,
    bridgePanelCount,
    bridgeCenterZ,
    bridgeLength,
    switchPosition,
    puzzleSwitch,
    switchButtonMaterial,
    switchButton,
    switchRing,
    stars,
    debris,
    portal,
    portalPosition,
    exitPlatformZ,
    exitPlatformRadius: 2.0,
    levelTwo,
    levelTwoX,
    levelTwoPlatforms,
    levelTwoSwitches,
    levelTwoBridgePanels,
    levelTwoBridgeCenterZ,
    levelTwoBridgeLength,
    levelTwoPortal,
    levelTwoPortalPosition,
    levelTwoExitZ: -10.7,
    levelTwoExitRadius: 1.55,
    levelThree,
    levelThreeX,
    levelThreePlatforms,
    levelThreeRelays,
    levelThreeBridgePanels,
    levelThreeBridgeCenterZ,
    levelThreeBridgeLength,
    levelThreePortal,
    levelThreePortalPosition,
  };
}
