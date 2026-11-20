import { Box3, Vector3 } from './vendor/three.module.js';

export function displaySystem(record) {
  const name = record.name.toLowerCase();
  // Extraocular muscles are eye motility muscles around the orbit; classifying them under Sensory
  // gives Sensory a complete, unified ophthalmic organ and lets Muscular represent the contiguous
  // lower-limb muscular anatomy without disjoint 1-meter framing gaps.
  if (/extraocular/.test(name)) return 'Sensory';
  if (record.system !== 'Visceral') return record.system;
  if (/kidney|renal pelvis|ureter|urethra|urinary/.test(name)) return 'Urinary';
  if (/penis|ductus deferens|ejaculatory|epididymis|prostate|seminal|testis/.test(name)) return 'Reproductive';
  if (/hypophysis|parathyroid|pineal|suprarenal|thyroid gland/.test(name)) return 'Endocrine';
  if (/pharynx|epiglottis|lung|nasal cavity|bronch|trachea|pleura/.test(name)) return 'Respiratory';
  return 'Digestive';
}

// Preserve size and orientation. Radial displacement opens the major spaces;
// a smaller, stable offset distinguishes parts with coincident centers.
export function spaceSystem(parts, aspect) {
  const original = new Box3();
  for (const p of parts) {
    original.expandByPoint(new Vector3(...p.min));
    original.expandByPoint(new Vector3(...p.max));
  }
  const center = original.getCenter(new Vector3());
  const extent = original.getSize(new Vector3());
  const radius = Math.max(.035, extent.length() * .10);
  const expanded = new Box3();
  for (const p of parts) {
    const offset = p.center.clone().sub(center);
    offset.x *= 1.45;
    offset.y *= .52;
    offset.z *= 1.25;
    const angle = (p.id + 1) * 2.39996322973;
    const elevation = Math.sin((p.id + 1) * 1.618);
    const lateral = Math.sqrt(1 - elevation * elevation);
    offset.addScaledVector(new Vector3(Math.cos(angle)*lateral, elevation, Math.sin(angle)*lateral), radius * .55);
    p.scale = 1;
    p.target.copy(p.center).add(offset);
    expanded.expandByPoint(new Vector3(...p.min).add(offset));
    expanded.expandByPoint(new Vector3(...p.max).add(offset));
  }
  function height(box) {
    const size = box.getSize(new Vector3());
    // 1.58x framing ensures full visibility of elongated anatomy (such as lower limbs or spine)
    // with comfortable clearance above the separation dock and below the top header.
    return 1.58 * Math.max(size.y, Math.hypot(size.x,size.z)/aspect, .06);
  }
  return {center, expandedCenter:expanded.getCenter(new Vector3()), height:height(original), expandedHeight:height(expanded)};
}

