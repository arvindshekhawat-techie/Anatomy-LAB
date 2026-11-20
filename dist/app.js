import * as THREE from './vendor/three.module.js';
import { displaySystem, spaceSystem } from './system-layout.js';
import { initAIChat, updateAIContext } from './ai-chat.js';

const $ = (id) => document.getElementById(id);
const files = ['muscular', 'skeletal', 'joints', 'cardiovascular', 'nervous', 'visceral', 'lymphatic'];
const scene = new THREE.Scene();

// Dual camera rig: Perspective for realistic 3D human form, Orthographic for CAD-style view
const orthoCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 150);
const perspCamera = new THREE.PerspectiveCamera(35, 1, 0.05, 100);
let camera = perspCamera;
let isPerspective = true;

const pivot = new THREE.Vector3(0, 0.85, 0);
let yaw = 0.55, pitch = 0.12, zoom = 1, spread = 0, frameHeight = 1.96, layoutHeight = 2;
let renderer, parts = [], selected = null, dirty = true, ready = false, spin = false;

const shared = {
  uSpread: { value: 0 },
  uTable: { value: null },
  uPicked: { value: -1 },
  uColorTable: { value: null }
};

const root = new THREE.Group();
scene.add(root);
const textureWidth = 256;
let transforms;
let body = 'male', system = 'Whole body', visibleParts = [], loadController;
let assembledHeight = 1.96, targetSpread = 0, lastFrame = 0;
const assembledCenter = new THREE.Vector3(0, 0.85, 0), separatedCenter = assembledCenter.clone();

function centeredPivot() {
  pivot.copy(assembledCenter).lerp(separatedCenter, spread);
}

// Physiological tissue classification and realistic color mapping
function getTissueInfo(p) {
  const name = (p.name + ' ' + (p.latin || '')).toLowerCase();
  const sys = p.system;

  // 1. Integumentary (Skin, Areola, Adipose)
  if (/skin|integument/i.test(name) || (sys === 'Integumentary' && /skin/i.test(name))) {
    return { code: 8, color: [0.86, 0.68, 0.56], rough: 0.55 }; // Real human skin
  }
  if (/areola|nipple|areolar/i.test(name)) {
    return { code: 8, color: [0.76, 0.46, 0.42], rough: 0.52 }; // Areola / nipple
  }
  if (/fat|adipose/i.test(name)) {
    return { code: 10, color: [0.92, 0.82, 0.40], rough: 0.65 }; // Adipose lipid lobules
  }

  // 2. Cardiovascular (Arteries, Veins, Heart)
  if (/vein|vena|venous|sinus.*dura|jugular|azygos|cardiac vein/i.test(name)) {
    return { code: 5, color: [0.12, 0.38, 0.82], rough: 0.28 }; // Rich venous royal blue
  }
  if (/heart|myocardi|atrium|ventricle|papillary|leaflet|valv/i.test(name)) {
    return { code: 7, color: [0.65, 0.14, 0.14], rough: 0.32 }; // Deep cardiac crimson
  }
  if (/arter|aorta|carotid|celiac|coeliac|trunk|anastomosis|arch|branch/i.test(name) || sys === 'Cardiovascular') {
    return { code: 4, color: [0.86, 0.12, 0.12], rough: 0.28 }; // Oxygenated arterial scarlet
  }

  // 3. Nervous (Nerves, Brain, Cord, Ganglia)
  if (!/iliotibial/i.test(name) && (/nerve|nervus|brain|cerebr|cerebell|medulla|spinal cord|gangli|nucleus|gyrus|sulcus|thalamus|pons|chiasm|olfactor|optic|\btract\b/i.test(name) || sys === 'Nervous')) {
    return { code: 6, color: [0.94, 0.80, 0.28], rough: 0.38 }; // Myelinated golden amber
  }

  // 4. Lymphatic
  if (/spleen|splen|lien/i.test(name)) {
    return { code: 7, color: [0.46, 0.12, 0.24], rough: 0.30 }; // Spleen plum
  }
  if (/lymph|thymus/i.test(name) || sys === 'Lymphatic') {
    return { code: 9, color: [0.34, 0.72, 0.42], rough: 0.32 }; // Luminous jade green
  }

  // 5. Skeletal & Cartilage / Joints
  if (/cartilage|cartilago|meniscus|articular|intervertebral disc|labrum/i.test(name) || sys === 'Joints') {
    return { code: 3, color: [0.76, 0.86, 0.94], rough: 0.22 }; // Hyaline pearlescent blue-white
  }
  if (/bone|skeleton|vertebra|rib|femur|cranium|skull|mandib|maxill|scapula|clavicle|humerus|radius|ulna|ilium|ischium|pubis|sacrum|patella|tibia|fibula|carpal|metacarpal|phalang|tarsal|metatarsal|incus|malleus|stapes/i.test(name) || sys === 'Skeletal') {
    return { code: 2, color: [0.93, 0.89, 0.81], rough: 0.65 }; // Warm biological ivory
  }

  // 6. Muscular, Tendons & Fascia
  if (/tendon|tendo|aponeurosis|retinaculum|ligament|iliotibial/i.test(name)) {
    return { code: 1, color: [0.88, 0.90, 0.93], rough: 0.28 }; // Pearlescent collagen white
  }
  if (sys === 'Muscular' || /muscle|musculus|fascia|intermuscular septum/i.test(name)) {
    return { code: 1, color: [0.55, 0.12, 0.10], rough: 0.38 }; // Deep physiological vascular crimson
  }

  // 7. Visceral Organs
  if (/liver|hepatic/i.test(name)) {
    return { code: 7, color: [0.46, 0.14, 0.12], rough: 0.28 }; // Deep hepatic burgundy
  }
  if (/gallbladder|bile duct|cystic duct/i.test(name)) {
    return { code: 7, color: [0.15, 0.48, 0.25], rough: 0.22 }; // Biliary emerald green
  }
  if (/lung|pulmo|bronch|trachea|larynx|pleura/i.test(name) || sys === 'Respiratory') {
    return { code: 7, color: [0.82, 0.48, 0.50], rough: 0.58 }; // Spongy pulmonary pink
  }
  if (/kidney|renal|ureter|urinary bladder|bladder|urethra/i.test(name) || sys === 'Urinary') {
    return { code: 7, color: [0.52, 0.16, 0.15], rough: 0.30 }; // Renal mahogany
  }
  if (/pancreas|pancreatic/i.test(name)) {
    return { code: 7, color: [0.85, 0.68, 0.42], rough: 0.42 }; // Lobular pancreatic buff
  }
  if (/stomach|gaster|colon|duoden|jejun|ileum|intestin|oesophag|rectum|caecum|appendix|omentum|mesenter|taenia|tongue|gingiva|palate|parotid|submandibular/i.test(name) || sys === 'Digestive') {
    return { code: 7, color: [0.82, 0.52, 0.44], rough: 0.34 }; // Glistening mucosal ochre-peach
  }
  if (/thyroid|adrenal|suprarenal|pineal|hypophysis|gland/i.test(name) || sys === 'Endocrine') {
    return { code: 7, color: [0.84, 0.60, 0.34], rough: 0.40 }; // Glandular amber-buff
  }
  if (/testis|prostate|penis|uterus|ovary|vagina|vulva|clitoris|fallopian|mammary|lactiferous|epididymis|ductus deferens|ejaculatory/i.test(name) || sys === 'Reproductive') {
    return { code: 7, color: [0.82, 0.45, 0.48], rough: 0.38 }; // Reproductive mucosal coral
  }
  if (/eye|lens|cornea|retina/i.test(name) || sys === 'Sensory') {
    return { code: 7, color: [0.92, 0.94, 0.96], rough: 0.15 }; // Cornea / sclera white
  }

  return { code: 7, color: [0.76, 0.50, 0.45], rough: 0.40 };
}

function indexSystems(triangles, ids) {
  const runs = new Map();
  let start = 0;
  while (start < triangles.length) {
    const key = parts[ids[triangles[start]]].system;
    let end = start + 3;
    while (end < triangles.length && parts[ids[triangles[end]]].system === key) end += 3;
    if (!runs.has(key)) runs.set(key, []);
    runs.get(key).push([start, end]);
    start = end;
  }
  const ranges = new Map();
  const sorted = runs.size === 1 ? triangles : new Uint32Array(triangles.length);
  let offset = 0;
  for (const [key, segments] of runs) {
    const first = offset;
    for (const [a, b] of segments) {
      if (sorted !== triangles) sorted.set(triangles.subarray(a, b), offset);
      offset += b - a;
    }
    ranges.set(key, [first, offset - first]);
  }
  return { sorted, ranges };
}

function filterMesh(mesh) {
  const range = system === 'Whole body' ? [0, mesh.geometry.index.count] : mesh.userData.ranges.get(system);
  mesh.visible = Boolean(range);
  if (range) mesh.geometry.setDrawRange(...range);
}

const positionCode = `
 attribute float partId;
 uniform sampler2D uTable;
 uniform float uSpread;
 varying float vId;
 vec3 transformedPosition() {
   int id = int(partId + 0.5);
   ivec2 coord = ivec2(id % 256, 2 * (id / 256));
   vec4 origin = texelFetch(uTable, coord, 0);
   vec4 exploded = texelFetch(uTable, coord + ivec2(0, 1), 0);
   vec3 p = position / 16000.0;
   float reveal = mix(smoothstep(0.0, 0.075, uSpread), 1.0, origin.w);
   vec3 center = mix(origin.xyz, exploded.xyz, uSpread);
   return center + (p - origin.xyz) * mix(1.0, exploded.w, uSpread) * reveal;
 }`;

function prepareMaterial(material) {
  material.onBeforeCompile = shader => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = positionCode + '\nuniform sampler2D uColorTable;\nattribute vec3 surface; varying vec3 vSurface; varying vec3 vBioColor; varying float vBioCode;\n' +
      shader.vertexShader.replace('#include <begin_vertex>', `
        vec3 transformed = transformedPosition();
        vSurface = surface / 16000.0;
        vId = partId;
        int pid = int(partId + 0.5);
        vec4 bio = texelFetch(uColorTable, ivec2(pid % 256, pid / 256), 0);
        vBioColor = bio.rgb;
        vBioCode = bio.a;
      `);

    shader.fragmentShader = 'varying float vId; varying vec3 vSurface; varying vec3 vBioColor; varying float vBioCode; uniform float uPicked;\n' +
      shader.fragmentShader
        .replace('#include <color_fragment>', `
          #include <color_fragment>
          // Linearize vertex color from sRGB to linear RGB for true PBR lighting
          vec3 vertColor = pow(max(diffuseColor.rgb, vec3(0.001)), vec3(2.2));
          float tissueCode = floor(vBioCode + 0.5);

          // Blend painted vertex colors with biological tissue classification
          vec3 baseBio = vBioColor;
          if (tissueCode == 1.0) {
            // Muscle: rich arterial myoglobin crimson with silvery tendon/fascia insertions
            baseBio = mix(vertColor, vBioColor, 0.65);
            float isTendon = 1.0 - smoothstep(0.03, 0.28, vSurface.z);
            baseBio = mix(baseBio, vec3(0.88, 0.90, 0.93), isTendon * 0.70);
          } else if (tissueCode == 2.0) {
            // Cortical bone: warm living ivory
            baseBio = mix(vertColor, vec3(0.92, 0.88, 0.80), 0.60);
          } else if (tissueCode == 3.0) {
            // Cartilage & joints: hyaline pearlescent blue-white
            baseBio = mix(vertColor, vec3(0.76, 0.86, 0.94), 0.70);
          } else if (tissueCode == 4.0) {
            // Oxygenated arterial scarlet
            baseBio = mix(vertColor, vec3(0.84, 0.10, 0.10), 0.80);
          } else if (tissueCode == 5.0) {
            // Deoxygenated venous royal blue
            baseBio = mix(vertColor, vec3(0.10, 0.32, 0.78), 0.80);
          } else if (tissueCode == 6.0) {
            // Myelinated golden amber nerves
            baseBio = mix(vertColor, vec3(0.92, 0.78, 0.22), 0.80);
          } else if (tissueCode == 8.0) {
            // Living human skin
            baseBio = mix(vertColor, vec3(0.86, 0.68, 0.56), 0.60);
          } else {
            baseBio = (length(vBioColor) > 0.05) ? mix(vertColor, vBioColor, 0.65) : vertColor;
          }

          // Skin layer adjustments in female HRA
          if (abs(vSurface.z - 0.20) < 0.045) {
            baseBio = mix(baseBio, vec3(0.86, 0.68, 0.56), 0.65);
          } else if (vSurface.z >= 0.30 && vSurface.z < 0.50) {
            baseBio = mix(baseBio, vec3(0.90, 0.80, 0.38), 0.55); // Adipose
          }

          // Anatomic inter-muscular boundary seam (septum groove):
          // Delineates the sculptural edge where adjacent muscle bellies interface
          float idSeam = smoothstep(0.04, 0.65, fwidth(vId));
          baseBio = mix(baseBio, baseBio * 0.45, idSeam * 0.52);

          diffuseColor.rgb = baseBio;

          // Organic striated myofibril fascicle texture
          if (tissueCode == 1.0 || vSurface.z >= 0.90) {
            float phase = 650.0 * vSurface.x + 1.8 * sin(vSurface.y * 40.0) + 0.8 * sin(vSurface.y * 120.0);
            float visibleGrain = 1.0 - smoothstep(1.5, 6.0, fwidth(phase));
            float fibres = (sin(phase) * 0.20 + sin(phase * 0.25) * 0.06) * visibleGrain;
            diffuseColor.rgb *= (1.0 + fibres);
          }

          // Dermal micro-pore grain
          if (tissueCode == 8.0 || abs(vSurface.z - 0.20) < 0.045) {
            float grain = sin(vSurface.x * 870.0 + sin(vSurface.y * 311.0)) * sin(vSurface.y * 733.0);
            float grainFade = 1.0 - smoothstep(0.3, 1.8, fwidth(vSurface.x) * 870.0);
            diffuseColor.rgb *= (1.0 + grain * 0.02 * grainFade);
          }
        `)
        .replace('#include <roughnessmap_fragment>', `
          #include <roughnessmap_fragment>
          if (tissueCode == 1.0) roughnessFactor = (vSurface.z < 0.35) ? 0.26 : 0.32; // Moist muscle & glistening tendon
          else if (tissueCode == 2.0) roughnessFactor = 0.58; // Cortical bone
          else if (tissueCode == 3.0) roughnessFactor = 0.15; // Cartilage (slick hyaline)
          else if (tissueCode == 4.0 || tissueCode == 5.0) roughnessFactor = 0.22; // Vascular endothelium
          else if (tissueCode == 6.0) roughnessFactor = 0.32; // Nerves
          else if (tissueCode == 7.0) roughnessFactor = 0.24; // Viscera (peritoneal serosa)
          else if (tissueCode == 8.0) roughnessFactor = 0.50; // Skin
          else if (tissueCode == 9.0) roughnessFactor = 0.26; // Lymphatic
          else if (tissueCode == 10.0) roughnessFactor = 0.62; // Adipose
          else roughnessFactor = 0.36;
        `)
        .replace('#include <emissivemap_fragment>', `
          #include <emissivemap_fragment>
          vec3 viewD = normalize(vViewPosition);
          float nDotV = clamp(dot(normal, -viewD), 0.0, 1.0);
          float rim = 1.0 - nDotV;

          // Subsurface Scattering (SSS) / Translucency: warm capillary blood scatter glow at silhouettes
          float sssIntensity = pow(rim, 4.0);
          vec3 sssBloodColor = (tissueCode == 3.0) ? vec3(0.20, 0.55, 0.85) :
                               (tissueCode == 5.0) ? vec3(0.08, 0.28, 0.75) :
                               (tissueCode == 6.0) ? vec3(0.85, 0.70, 0.20) :
                               vec3(0.85, 0.12, 0.08);
          float sssWeight = (tissueCode == 2.0) ? 0.02 : (tissueCode == 8.0) ? 0.14 : (tissueCode == 1.0) ? 0.10 : 0.08;
          totalEmissiveRadiance += sssBloodColor * (sssIntensity * sssWeight);

          // Moist Serosa / Synovial Fluid Sheen: high-order glancing angle Fresnel reflection
          float moisture = (tissueCode == 3.0) ? 0.30 : (tissueCode == 7.0) ? 0.28 : (tissueCode == 4.0 || tissueCode == 5.0) ? 0.25 : (tissueCode == 1.0) ? 0.18 : 0.06;
          float serosaSheen = pow(rim, 5.2) * moisture * 0.35;
          totalEmissiveRadiance += vec3(0.85, 0.92, 1.0) * serosaSheen;

          // Precision Medical Selection Glow
          if (abs(vId - uPicked) < 0.25) {
            vec3 selGlow = vec3(0.12, 0.85, 1.0);
            float selRim = pow(rim, 1.8);
            totalEmissiveRadiance += selGlow * (0.35 + 0.85 * selRim);
          }
        `)
        .replace('#include <dithering_fragment>', `
          #include <dithering_fragment>
          // Crevice & Cavity Occlusion: deepens crevices between muscle bellies, sulci, and bone grooves
          float normalCurvature = length(fwidth(normal));
          float cavity = clamp(1.0 - normalCurvature * 0.45, 0.62, 1.0);
          gl_FragColor.rgb *= cavity;
        `);
  };
  return material;
}

const pickMaterial = new THREE.ShaderMaterial({
  uniforms: shared,
  side: THREE.DoubleSide,
  vertexShader: positionCode + '\nvoid main(){vId=partId;gl_Position=projectionMatrix*modelViewMatrix*vec4(transformedPosition(),1.);}',
  fragmentShader: 'varying float vId; void main(){float n=vId+1.;gl_FragColor=vec4(mod(n,256.)/255.,floor(n/256.)/255.,0.,1.);}'
});

const pickTarget = new THREE.WebGLRenderTarget(1, 1, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });

async function loadGeometry(folder, file, signal) {
  const response = await fetch(folder + '/' + file + '.bin.gz', { signal });
  if (!response.ok) throw Error(file + ' unavailable');
  const bytes = new Uint8Array(await response.arrayBuffer());
  const packed = bytes[0] === 31 && bytes[1] === 139
    ? await new Response(new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer()
    : bytes.buffer;
  signal.throwIfAborted();
  const [vertices, indices] = new Uint32Array(packed, 0, 2);
  let offset = 8;
  function read(Type, count) {
    const result = new Type(packed, offset, count);
    offset = (offset + result.byteLength + 3) & ~3;
    return result;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(read(Int16Array, vertices * 3), 3));
  geometry.setAttribute('normal', new THREE.BufferAttribute(read(Int8Array, vertices * 3), 3, true));
  geometry.setAttribute('color', new THREE.BufferAttribute(read(Uint8Array, vertices * 3), 3, true));
  geometry.setAttribute('surface', new THREE.BufferAttribute(read(Int16Array, vertices * 3), 3));
  geometry.setAttribute('partId', new THREE.BufferAttribute(read(Uint16Array, vertices), 1));
  const triangles = read(Uint32Array, indices);
  for (let i = 1; i < indices; i++) triangles[i] += triangles[i - 1];
  const { sorted, ranges } = indexSystems(triangles, geometry.getAttribute('partId').array);
  geometry.setIndex(new THREE.BufferAttribute(sorted, 1));
  const material = prepareMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.35, metalness: 0.04 }));
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.userData.ranges = ranges;
  filterMesh(mesh);
  root.add(mesh);
  dirty = true;
}

function prepareParts(records) {
  parts = records.map(p => {
    const box = new THREE.Box3(new THREE.Vector3(...p.min), new THREE.Vector3(...p.max));
    return {
      ...p,
      system: displaySystem(p),
      center: box.getCenter(new THREE.Vector3()),
      size: box.getSize(new THREE.Vector3()),
      target: new THREE.Vector3(),
      scale: 1
    };
  });
  const height = 2 * Math.ceil(parts.length / textureWidth);
  transforms = new Float32Array(textureWidth * height * 4);
  shared.uTable.value = new THREE.DataTexture(transforms, textureWidth, height, THREE.RGBAFormat, THREE.FloatType);

  // Allocate GPU tissue color and material attribute table
  const colorHeight = Math.ceil(parts.length / textureWidth);
  const colorData = new Float32Array(textureWidth * colorHeight * 4);
  for (const p of parts) {
    const info = getTissueInfo(p);
    const idx = 4 * p.id;
    colorData[idx] = info.color[0];
    colorData[idx + 1] = info.color[1];
    colorData[idx + 2] = info.color[2];
    colorData[idx + 3] = info.code;
  }
  shared.uColorTable.value = new THREE.DataTexture(colorData, textureWidth, colorHeight, THREE.RGBAFormat, THREE.FloatType);
  shared.uColorTable.value.needsUpdate = true;
}

function layout(aspect) {
  if (system !== 'Whole body') {
    const frame = spaceSystem(visibleParts, aspect);
    assembledCenter.copy(frame.center);
    separatedCenter.copy(frame.expandedCenter);
    assembledHeight = frame.height;
    layoutHeight = frame.expandedHeight;
    writeTransforms(visibleParts);
    return;
  }
  assembledCenter.set(0, 0.85, 0);
  separatedCenter.copy(assembledCenter);
  assembledHeight = Math.max(1.90, 0.76 / aspect);
  const sorted = [...parts].sort((a, b) => a.system.localeCompare(b.system) || b.size.length() - a.size.length() || a.id - b.id);
  let totalArea = 0;
  for (const p of sorted) {
    const longest = Math.max(p.size.x, p.size.y, p.size.z, 0.001);
    p.scale = THREE.MathUtils.clamp(0.075 * Math.pow(longest / 0.10, 0.45) / longest, 0.16, 12);
    p.w = Math.max(0.012, p.size.x * p.scale) + 0.014;
    p.h = Math.max(0.012, p.size.y * p.scale) + 0.014;
    totalArea += p.w * p.h;
  }
  const width = Math.sqrt(totalArea * Math.max(0.4, aspect) * 1.35);
  let x = 0, y = 0, rowHeight = 0;
  for (const p of sorted) {
    if (x && x + p.w > width) {
      y += rowHeight;
      x = 0;
      rowHeight = 0;
    }
    p.target.set(x + p.w / 2 - width / 2, -y - p.h / 2, 0);
    x += p.w;
    rowHeight = Math.max(rowHeight, p.h);
  }
  const height = y + rowHeight;
  layoutHeight = Math.max(height, width / aspect) * 1.08;
  for (const p of parts) p.target.y += 0.85 + height / 2;
  writeTransforms(parts);
}

function writeTransforms(list) {
  for (const p of list) {
    const base = 4 * (2 * Math.floor(p.id / textureWidth) * textureWidth + p.id % textureWidth);
    const surfaceOnly = body === 'female' && system === 'Whole body';
    const exterior = /^(Skin$|Nipple |Areola |Areolar tubercles )/.test(p.name);
    // In male body, superficial fascia sheaths cover and occlude the rich musculature at rest.
    // Reveal them as the user separates the parts with the slider.
    const isSuperficialFascia = /fascia/i.test(p.name) && !/tensor fasciae/i.test(p.name);
    const hideAtRest = (surfaceOnly && !exterior) || (body === 'male' && isSuperficialFascia);
    transforms.set([...p.center.toArray(), Number(!hideAtRest)], base);
    transforms.set([...p.target.toArray(), p.scale], base + 4 * textureWidth);
  }
  shared.uTable.value.needsUpdate = true;
}

function cameraUpdate() {
  const canvasEl = $('canvas');
  const aspect = canvasEl.clientWidth / Math.max(1, canvasEl.clientHeight);
  frameHeight = THREE.MathUtils.lerp(assembledHeight, layoutHeight, spread) / zoom;

  if (isPerspective) {
    camera = perspCamera;
    const fov = 35;
    const dist = (frameHeight / 2) / Math.tan(THREE.MathUtils.degToRad(fov / 2));
    perspCamera.aspect = aspect;
    perspCamera.fov = fov;
    perspCamera.near = Math.max(0.02, dist * 0.05);
    perspCamera.far = Math.max(80, dist * 5.0);
    perspCamera.position.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).multiplyScalar(dist).add(pivot);
    perspCamera.lookAt(pivot);
    perspCamera.updateProjectionMatrix();
    perspCamera.updateMatrixWorld();
  } else {
    camera = orthoCamera;
    orthoCamera.top = frameHeight / 2;
    orthoCamera.bottom = -orthoCamera.top;
    orthoCamera.right = orthoCamera.top * aspect;
    orthoCamera.left = -orthoCamera.right;
    orthoCamera.position.set(
      Math.sin(yaw) * Math.cos(pitch),
      Math.sin(pitch),
      Math.cos(yaw) * Math.cos(pitch)
    ).multiplyScalar(18).add(pivot);
    orthoCamera.lookAt(pivot);
    orthoCamera.updateProjectionMatrix();
    orthoCamera.updateMatrixWorld();
  }
  dirty = true;
}

function resize() {
  const rect = $('canvas').getBoundingClientRect();
  renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
  if (parts.length) layout(rect.width / Math.max(1, rect.height));
  cameraUpdate();
}

function moveSlider(value) {
  targetSpread = Number(value) / 100;
  $('amount').textContent = Math.round(targetSpread * 100) + '%';
  centeredPivot();
  zoom = 1;
  cameraUpdate();
}

function pick(event) {
  if (!ready) return;
  const r = $('canvas').getBoundingClientRect();
  const x = Math.floor((event.clientX - r.left) * renderer.domElement.width / r.width);
  const y = Math.floor((event.clientY - r.top) * renderer.domElement.height / r.height);
  camera.setViewOffset(renderer.domElement.width, renderer.domElement.height, x, y, 1, 1);
  const savedAlpha = renderer.getClearAlpha(), savedColor = renderer.getClearColor(new THREE.Color());
  renderer.setClearColor(0, 0);
  scene.overrideMaterial = pickMaterial;
  renderer.setRenderTarget(pickTarget);
  renderer.render(scene, camera);
  const pixel = new Uint8Array(4);
  renderer.readRenderTargetPixels(pickTarget, 0, 0, 1, 1, pixel);
  renderer.setRenderTarget(null);
  scene.overrideMaterial = null;
  camera.clearViewOffset();
  renderer.setClearColor(savedColor, savedAlpha);
  const part = parts[pixel[0] + pixel[1] * 256 - 1];
  if (part) select(part);
  else closeCard();
  dirty = true;
}

function closeCard() {
  selected = null;
  shared.uPicked.value = -1;
  $('card').hidden = true;
  for (const id of ['part-name', 'part-note', 'part-system', 'latin']) $(id).textContent = '';
  $('source').removeAttribute('href');
  $('source').hidden = true;
  dirty = true;
  updateAIContext();
}

function locationNote(p) {
  const other = parts.filter(q => q.system === p.system && q.id !== p.id && q.name !== p.name)
    .reduce((best, q) => q.center.distanceToSquared(p.center) < best.distance ? { name: q.name, distance: q.center.distanceToSquared(p.center) } : best, { name: '', distance: Infinity });
  return other.name ? 'In the assembled body, this structure lies near the ' + other.name.charAt(0).toLowerCase() + other.name.slice(1) + '.' : 'Part of the ' + p.system.toLowerCase() + ' anatomy shown here.';
}

function select(part) {
  selected = part;
  shared.uPicked.value = part.id;
  dirty = true;
  $('part-name').textContent = part.name;
  $('part-system').textContent = part.system;
  $('part-note').textContent = part.note || locationNote(part);
  $('latin').textContent = part.latin;
  $('latin').hidden = !part.latin;
  const source = $('source');
  source.hidden = true;
  if (part.note && /^https?:\/\/(?:[a-z]+\.)?wikipedia\.org\//i.test(part.source)) {
    source.href = part.source;
    source.hidden = false;
  }
  $('card').hidden = false;
  updateAIContext();
}

function focusPart() {
  if (!selected) return;
  pivot.copy(selected.center).lerp(selected.target, spread);
  const size = selected.size.length() * THREE.MathUtils.lerp(1, selected.scale, spread);
  zoom = THREE.MathUtils.clamp(frameHeight * zoom / Math.max(0.015, size * 1.65), 0.5, 450);
  cameraUpdate();
}

function zoomBy(factor) {
  zoom = THREE.MathUtils.clamp(zoom * factor, 0.45, 450);
  cameraUpdate();
}

function reset() {
  yaw = 0.55;
  pitch = 0.12;
  zoom = 1;
  centeredPivot();
  setAngle('Perspective');
  cameraUpdate();
}

function setAngle(label) {
  const angles = { Front: [0, 0], Back: [Math.PI, 0], Side: [Math.PI / 2, 0], Perspective: [0.55, 0.12] };
  if (angles[label]) {
    [yaw, pitch] = angles[label];
  }
  document.querySelectorAll('[data-angle]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.angle === label)));
  cameraUpdate();
}

function toggleCameraMode() {
  isPerspective = !isPerspective;
  const btn = $('cam-mode');
  if (btn) {
    btn.textContent = isPerspective ? '3D' : 'CAD';
    btn.setAttribute('aria-pressed', String(isPerspective));
    btn.title = isPerspective ? 'Camera mode: 3D Perspective (Click for Ortho CAD)' : 'Camera mode: Orthographic CAD (Click for 3D Perspective)';
  }
  cameraUpdate();
}

function applyTheme(theme) {
  document.documentElement.setAttribute('data-theme', theme);
  localStorage.setItem('anatomy-lab-theme', theme);
  const btn = $('theme-toggle');
  if (btn) btn.textContent = theme === 'dark' ? '☀️' : '🌙';
  const metaTheme = document.querySelector('meta[name="theme-color"]');
  if (metaTheme) metaTheme.content = theme === 'dark' ? '#090d16' : '#f8fafc';
  dirty = true;
}

function showResults() {
  const query = $('search').value.trim().toLowerCase();
  const list = $('results');
  list.replaceChildren();
  list.hidden = !query;
  if (!query) return;
  const matches = visibleParts.filter(p => p.name.toLowerCase().includes(query) || (p.latin && p.latin.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.name.toLowerCase() === query) - Number(a.name.toLowerCase() === query)).slice(0, 22);
  if (!matches.length) {
    list.textContent = 'No matching structures';
    return;
  }
  for (const p of matches) {
    const b = document.createElement('button');
    b.textContent = p.name;
    const detail = document.createElement('small');
    detail.textContent = p.system;
    b.append(detail);
    b.onclick = () => {
      select(p);
      focusPart();
      list.hidden = true;
      $('search').value = '';
    };
    list.append(b);
  }
}

const pointers = new Map();
let moved = false, start = null, pinch = 0;
const canvas = $('canvas');

canvas.onpointerdown = e => {
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 1) {
    moved = false;
    start = [e.clientX, e.clientY];
  } else {
    moved = true;
    pinch = 0;
  }
};

canvas.onpointermove = e => {
  if (!pointers.has(e.pointerId)) return;
  const last = pointers.get(e.pointerId), dx = e.clientX - last[0], dy = e.clientY - last[1];
  pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()], distance = Math.hypot(a[0] - b[0], a[1] - b[1]);
    if (pinch > 0) zoomBy(distance / pinch);
    pinch = distance;
    return;
  }
  if (Math.hypot(e.clientX - start[0], e.clientY - start[1]) > 4) moved = true;
  if (!moved) return;
  if (e.shiftKey || e.buttons === 2 || (system === 'Whole body' && spread > 0.85 && !e.altKey)) {
    const scale = frameHeight / canvas.clientHeight;
    pivot.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0), -dx * scale);
    pivot.addScaledVector(new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1), dy * scale);
  } else {
    yaw -= dx * 0.006;
    pitch = THREE.MathUtils.clamp(pitch + dy * 0.006, -1.48, 1.48);
  }
  cameraUpdate();
};

canvas.onpointerup = e => {
  if (pointers.has(e.pointerId) && !moved && e.button === 0) pick(e);
  pointers.delete(e.pointerId);
};

canvas.onpointercancel = e => {
  pointers.delete(e.pointerId);
  moved = true;
};

canvas.oncontextmenu = e => e.preventDefault();
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  zoomBy(Math.exp(-THREE.MathUtils.clamp(e.deltaY, -300, 300) * 0.002));
}, { passive: false });

$('explode').oninput = e => moveSlider(e.target.value);
$('close').onclick = closeCard;
$('focus').onclick = focusPart;
$('in').onclick = () => zoomBy(1.35);
$('out').onclick = () => zoomBy(1 / 1.35);
$('home').onclick = reset;
$('rotate').onclick = () => {
  spin = !spin;
  $('rotate').setAttribute('aria-pressed', String(spin));
};
$('cam-mode').onclick = toggleCameraMode;

document.querySelectorAll('[data-angle]').forEach(b => b.onclick = () => setAngle(b.dataset.angle));
$('search').oninput = showResults;
$('help').onclick = () => $('help-dialog').showModal();
$('dismiss').onclick = () => $('help-dialog').close();
$('dialog-done').onclick = () => $('help-dialog').close();

const themeBtn = $('theme-toggle');
if (themeBtn) {
  themeBtn.onclick = () => {
    const current = document.documentElement.getAttribute('data-theme') || 'dark';
    applyTheme(current === 'dark' ? 'light' : 'dark');
  };
}

// Initial theme apply
const initialTheme = localStorage.getItem('anatomy-lab-theme') || 'dark';
applyTheme(initialTheme);

document.addEventListener('keydown', e => {
  if (e.key === 'Escape') {
    $('results').hidden = true;
    closeCard();
  }
  if (e.key === '/' && document.activeElement !== $('search')) {
    e.preventDefault();
    $('search').focus();
  }
  if (e.key === 'i' && (e.ctrlKey || e.metaKey)) {
    e.preventDefault();
    $('ai-toggle')?.click();
  }
});

function draw(t) {
  requestAnimationFrame(draw);
  const dt = Math.min(0.06, Math.max(0, (t - lastFrame) / 1000));
  lastFrame = t;
  if (ready && spread !== targetSpread) {
    spread = THREE.MathUtils.lerp(spread, targetSpread, 1 - Math.exp(-dt * 18));
    if (Math.abs(targetSpread - spread) < 0.0006) spread = targetSpread;
    shared.uSpread.value = spread;
    centeredPivot();
    cameraUpdate();
  }
  if (spin && ready) {
    yaw += dt * 0.24;
    cameraUpdate();
  }
  if (dirty) {
    renderer.render(scene, camera);
    dirty = false;
  }
}

$('system-picker').onchange = e => chooseSystem(e.target.value);
for (const button of document.querySelectorAll('[data-body]')) {
  button.onclick = () => {
    if (button.dataset.body !== body) loadBody(button.dataset.body);
  };
}

try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.6));
  renderer.setClearColor(0, 0);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  // Balanced 7-point surgical studio lighting setup for rich biological color & 3D volume
  scene.add(new THREE.HemisphereLight(0xf5f7fb, 0x140e0c, 0.38));
  const studioLights = [
    [-2.2, 3.8, 4.2, 1.35, 0xfff7ed],  // Warm surgical key light
    [2.8, 1.5, 3.2, 0.45, 0xebf2fe],   // Cool ambient fill
    [-3.8, 1.8, -3.8, 0.65, 0xd0e0fd], // Left silhouette rim
    [3.8, 2.2, -3.2, 0.55, 0xffeedd],  // Right silhouette rim
    [0.0, 5.2, 0.1, 0.38, 0xffffff],   // Overhead cranial cap light
    [0.0, -3.8, 1.2, 0.20, 0x7c2d12]   // Floor ground bounce
  ];
  for (const [x, y, z, intensity, color] of studioLights) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(x, y, z);
    scene.add(light);
  }

  const initialParams = new URLSearchParams(window.location.search);
  const initialBody = (initialParams.get('body') === 'female') ? 'female' : 'male';

  // Initialize Generative AI Anatomy Chatbot immediately so it is interactive
  initAIChat({
    getContext: () => ({
      body,
      system,
      selected: selected ? {
        name: selected.name,
        latin: selected.latin,
        system: selected.system,
        note: selected.note
      } : null,
      totalStructures: visibleParts.length
    }),
    focusPartByName: (partName) => {
      const q = partName.toLowerCase().trim();
      const match = parts.find(p => p.name.toLowerCase() === q || p.name.toLowerCase().includes(q) || (p.latin && p.latin.toLowerCase().includes(q)));
      if (match) {
        if (system !== 'Whole body' && match.system !== system) {
          const picker = $('system-picker');
          if (picker) {
            picker.value = match.system;
            chooseSystem(match.system);
          }
        }
        select(match);
        focusPart();
        return true;
      }
      return false;
    }
  });

  new ResizeObserver(resize).observe(canvas);
  requestAnimationFrame(draw);
  await loadBody(initialBody);
} catch (error) {
  showError(error);
}

function showError(error) {
  console.error(error);
  $('loading').hidden = false;
  const loadText = $('loading-text') || $('loading');
  loadText.textContent = 'Unable to load the atlas.';
  $('retry').hidden = false;
  $('retry').onclick = () => loadBody(body);
}

function chooseSystem(value) {
  system = value;
  visibleParts = system === 'Whole body' ? parts : parts.filter(p => p.system === system);
  closeCard();
  $('results').replaceChildren();
  $('results').hidden = true;
  $('search').value = '';
  for (const mesh of root.children) filterMesh(mesh);
  spread = targetSpread = 0;
  shared.uSpread.value = 0;
  $('amount').textContent = '0%';
  $('explode').value = 0;
  $('section-name').textContent = system;
  $('count').textContent = visibleParts.length.toLocaleString() + ' structures';

  // Sync state to URL for bookmarking and easy sharing
  try {
    const url = new URL(window.location);
    url.searchParams.set('body', body);
    url.searchParams.set('system', system);
    window.history.replaceState(null, '', url.toString());
  } catch (_) {}

  resize();
  reset();
  updateAIContext();
}

async function loadBody(value) {
  loadController?.abort();
  const controller = new AbortController();
  loadController = controller;
  const signal = controller.signal;
  const previousSystem = system;
  ready = false;
  body = value;
  $('search').value = '';
  $('count').textContent = '';
  for (const button of document.querySelectorAll('[data-body]')) {
    button.setAttribute('aria-pressed', String(button.dataset.body === body));
  }
  for (const control of ['explode', 'search', 'system-picker']) $(control).disabled = true;
  $('loading').hidden = false;
  const loadText = $('loading-text') || $('loading');
  loadText.textContent = 'Loading anatomy…';
  $('retry').hidden = true;
  closeCard();
  $('results').replaceChildren();
  $('results').hidden = true;

  for (const mesh of [...root.children]) {
    root.remove(mesh);
    mesh.geometry.dispose();
    mesh.material.dispose();
  }
  shared.uTable.value?.dispose();
  shared.uTable.value = null;
  shared.uColorTable.value?.dispose();
  shared.uColorTable.value = null;
  parts = [];
  visibleParts = [];
  dirty = true;

  const folder = body === 'male' ? 'specimen' : 'female-hra';
  try {
    const fetchJSON = async name => {
      const response = await fetch(folder + '/' + name + '.json', { signal });
      if (!response.ok) throw Error('Atlas file unavailable: ' + name);
      return response.json();
    };
    const [records, assets] = await Promise.all([fetchJSON('parts'), body === 'male' ? files : fetchJSON('files')]);
    signal.throwIfAborted();
    prepareParts(records);
    const choices = ['Whole body', ...new Set(parts.map(p => p.system).sort())];
    const picker = $('system-picker');
    picker.replaceChildren(...choices.map(name => new Option(name, name)));
    const urlSystem = new URLSearchParams(window.location.search).get('system');
    const targetSystem = (urlSystem && choices.includes(urlSystem)) ? urlSystem : (choices.includes(previousSystem) ? previousSystem : 'Whole body');
    picker.value = targetSystem;
    chooseSystem(picker.value);
    for (const [i, file] of assets.entries()) {
      signal.throwIfAborted();
      loadText.textContent = 'Loading ' + body + ' anatomy · ' + (i + 1) + ' / ' + assets.length;
      await loadGeometry(folder, file, signal);
    }
    ready = true;
    $('loading').hidden = true;
    dirty = true;
    for (const control of ['explode', 'search', 'system-picker']) $(control).disabled = false;
  } catch (error) {
    if (!signal.aborted) showError(error);
  }
}
