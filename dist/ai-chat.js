// AI Anatomist: Generative AI Assistant & Intelligent Clinical Anatomy Engine

const STORAGE_KEY_GEMINI = 'anatomy-lab-gemini-key';
const STORAGE_KEY_HISTORY = 'anatomy-lab-chat-history';

let chatCallbacks = {
  getContext: () => ({ body: 'male', system: 'Whole body', selected: null, totalStructures: 0 }),
  focusPartByName: () => false
};

let isOpen = false;
let isGenerating = false;
let chatMessages = [];
let geminiApiKey = typeof localStorage !== 'undefined' ? (localStorage.getItem(STORAGE_KEY_GEMINI) || '') : '';
let serverHasKey = false;
let activeModelName = 'gemini-3.6-flash';

// Built-in Knowledge Base for Instant Clinical Answers (Zero-Config Mode)
const CLINICAL_KNOWLEDGE = {
  // Lower Limb Muscular
  'rectus femoris': {
    action: 'Extends leg at the knee joint; flexes thigh at the hip joint.',
    origin: 'Anterior inferior iliac spine (AIIS) and superior groove of acetabulum.',
    insertion: 'Patellar tendon into tibial tuberosity via patellar ligament.',
    innervation: 'Femoral nerve (L2, L3, L4).',
    blood: 'Lateral circumflex femoral artery.',
    clinical: 'Prone to quadriceps muscle strain in kicking sports (soccer, football). Crucial for kicking motion and sprinting acceleration.'
  },
  'sartorius': {
    action: 'Flexes, abducts, and laterally rotates thigh at hip; flexes leg at knee ("tailor\'s muscle").',
    origin: 'Anterior superior iliac spine (ASIS).',
    insertion: 'Superomedial surface of tibia as part of the pes anserinus ("goose foot").',
    innervation: 'Femoral nerve (L2, L3).',
    blood: 'Femoral artery and lateral circumflex femoral branches.',
    clinical: 'Longest muscle in the human body. Pes anserine bursitis causes medial knee pain in runners and cyclists.'
  },
  'gastrocnemius': {
    action: 'Plantarflexes foot at ankle joint; flexes leg at knee joint.',
    origin: 'Medial and lateral condyles of femur.',
    insertion: 'Posterior surface of calcaneus via Achilles tendon (tendo calcaneus).',
    innervation: 'Tibial nerve (S1, S2).',
    blood: 'Sural arteries (branches of popliteal artery).',
    clinical: 'Rupture of the Achilles tendon often occurs during explosive push-off (positive Thompson test).'
  },
  'gluteus maximus': {
    action: 'Major extensor and lateral rotator of the thigh; essential for standing up from a chair, climbing stairs.',
    origin: 'Gluteal surface of ilium, sacrum, coccyx, and sacrotuberous ligament.',
    insertion: 'Iliotibial tract and gluteal tuberosity of femur.',
    innervation: 'Inferior gluteal nerve (L5, S1, S2).',
    blood: 'Superior and inferior gluteal arteries.',
    clinical: 'Intramuscular injections are placed in the upper outer quadrant to prevent injury to the underlying sciatic nerve.'
  },
  'biceps femoris': {
    action: 'Flexes leg at knee joint; extends thigh at hip (long head); lateral rotator of flexed leg.',
    origin: 'Long head: ischial tuberosity; Short head: linea aspera of femur.',
    insertion: 'Head of fibula (lateral side).',
    innervation: 'Long head: Tibial division of sciatic nerve; Short head: Common fibular (peroneal) division.',
    blood: 'Perforating branches of profunda femoris artery.',
    clinical: 'Most frequently injured hamstring muscle during high-speed running terminal swing phase.'
  },
  'vastus lateralis': {
    action: 'Extends the leg at the knee joint; stabilizes the patella.',
    origin: 'Greater trochanter and lateral lip of linea aspera of femur.',
    insertion: 'Patella via quadriceps tendon and tibial tuberosity.',
    innervation: 'Femoral nerve (L2, L3, L4).',
    blood: 'Lateral circumflex femoral artery.',
    clinical: 'Preferred site for intramuscular injections in infants and pediatric patients due to absence of major nerves.'
  },
  // Sensory & Extraocular Eye Muscles
  'extraocular': {
    action: 'Coordinates 3D rotational motility and binocular gaze stabilization.',
    details: 'Consists of 6 muscles per eye: 4 recti (superior, inferior, medial, lateral) and 2 obliques (superior and inferior).',
    innervation: 'Formula: LR6 SO4 R3 (Lateral Rectus: CN VI Abducens; Superior Oblique: CN IV Trochlear; Remainder: CN III Oculomotor).',
    clinical: 'Oculomotor nerve palsy causes "down and out" eye deviation with ptosis; Abducens palsy causes horizontal diplopia.'
  },
  // Skeletal & Reproductive
  'uterus': {
    action: 'Houses gestational embryo/fetus; muscular contractions expel fetus during parturition.',
    parts: 'Fundus, body (corpus), isthmus, and cervix.',
    blood: 'Uterine artery (branch of anterior division of internal iliac artery) and ovarian artery.',
    supports: 'Cardinal (Mackenrodt), uterosacral, round, and broad ligaments.',
    clinical: 'Uterine leiomyomas (fibroids) are common benign smooth muscle neoplasms. Endometriosis involves ectopic endometrial tissue.'
  },
  'heart': {
    action: 'Four-chambered muscular organ providing dual systemic and pulmonary circulation.',
    chambers: 'Right atrium, right ventricle, left atrium, left ventricle.',
    perfusion: 'Left anterior descending (LAD), circumflex, and right coronary arteries (RCA).',
    conduction: 'Sinoatrial (SA) node -> AV node -> Bundle of His -> Purkinje fibers.',
    clinical: 'Myocardial infarction usually results from coronary atherothrombosis; LAD occlusion is termed the "widow-maker".'
  }
};

// Simple yet robust Markdown formatter
function formatMarkdown(text) {
  if (!text) return '';
  let html = text
    // Escape raw HTML entities
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    // Headers
    .replace(/^### (.*$)/gim, '<h5>$1</h5>')
    .replace(/^## (.*$)/gim, '<h4>$1</h4>')
    .replace(/^# (.*$)/gim, '<h3>$1</h3>')
    // Bold & italic
    .replace(/\*\*\*(.*?)\*\*\*/gim, '<b><i>$1</i></b>')
    .replace(/\*\*(.*?)\*\*/gim, '<b>$1</b>')
    .replace(/\*(.*?)\*/gim, '<i>$1</i>')
    // Focus link pills: [Focus: Part Name]
    .replace(/\[(?:Focus|Locate|View):\s*([^\]]+)\]/gi, (match, part) => {
      return `<button class="ai-focus-pill" data-part="${part.trim()}">⌖ Focus ${part.trim()}</button>`;
    })
    // Bullet lists
    .replace(/^\s*[-*]\s+(.*$)/gim, '<li>$1</li>')
    // Numbered lists
    .replace(/^\s*(\d+)\.\s+(.*$)/gim, '<li value="$1">$2</li>')
    // Inline code
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    // Paragraph line breaks
    .replace(/\n\n+/g, '</p><p>')
    .replace(/\n/g, '<br>');

  // Wrap lists
  html = html.replace(/(<li>.*?<\/li>)/gis, '<ul>$1</ul>');
  // Clean up nested ul
  html = html.replace(/<\/ul>\s*<ul>/g, '');

  return `<p>${html}</p>`;
}

// Generate intelligent contextual response using Built-in Anatomy Engine
function generateLocalResponse(query, context) {
  const q = query.toLowerCase();
  const selected = context.selected;

  // 1. If asking about currently selected part
  if (selected && (q.includes('this') || q.includes('it') || q.includes(selected.name.toLowerCase()) || q.includes('selected') || q.includes('clinical') || q.includes('function') || q.includes('nerve') || q.includes('artery'))) {
    const sName = selected.name;
    const lower = sName.toLowerCase();
    let specificInfo = null;

    for (const [key, val] of Object.entries(CLINICAL_KNOWLEDGE)) {
      if (lower.includes(key)) {
        specificInfo = val;
        break;
      }
    }

    if (specificInfo) {
      let res = `### Anatomical Profile: **${sName}**\n\n`;
      if (selected.latin) res += `*Latin:* *${selected.latin}* · System: **${selected.system}**\n\n`;
      if (specificInfo.action) res += `**🎯 Action & Function:**\n${specificInfo.action}\n\n`;
      if (specificInfo.origin) res += `**📍 Origin & Insertion:**\n- **Origin:** ${specificInfo.origin}\n- **Insertion:** ${specificInfo.insertion}\n\n`;
      if (specificInfo.innervation) res += `**⚡ Nerve Supply:**\n${specificInfo.innervation}\n\n`;
      if (specificInfo.blood) res += `**🩸 Arterial Perfusion:**\n${specificInfo.blood}\n\n`;
      if (specificInfo.clinical) res += `**🏥 Clinical Correlation:**\n${specificInfo.clinical}\n\n`;
      res += `*You can inspect this directly in 3D: [Focus: ${sName}]*`;
      return res;
    }

    return `### **${sName}** (${selected.system} System)\n\n` +
      (selected.latin ? `*Terminologia Anatomica:* *${selected.latin}*\n\n` : '') +
      `**Functional Role:**\nPart of the human ${selected.system.toLowerCase()} system. ` +
      (selected.note || `Contributes to biomechanical stability, physiological regulation, and anatomical continuity in the ${context.body} body.`) + '\n\n' +
      `**3D Interactive Action:**\nClick [Focus: ${sName}] to zoom into its coordinates.`;
  }

  // 2. Specific System explanations
  if (q.includes('muscular') || (context.system === 'Muscular' && q.includes('muscle'))) {
    if (context.body === 'female') {
      return `### Female Muscular Anatomy Overview\n\n` +
        `In this 3D atlas, the female muscular system represents the **complete pelvic and lower extremity musculature** derived from the *Visible Human Female* dataset (78 structures):\n\n` +
        `- **Gluteal & Hip Rotators:** [Focus: Gluteus maximus (right)], [Focus: Gluteus medius (left)], [Focus: Piriformis (right)], [Focus: Iliacus (right)], and [Focus: Psoas major (right)].\n` +
        `- **Anterior Thigh (Quadriceps):** [Focus: Rectus femoris (right)], Vastus lateralis, medialis, and intermedius (innervated by the Femoral nerve, L2-L4).\n` +
        `- **Posterior Thigh (Hamstrings):** [Focus: Biceps femoris long (left)], Semitendinosus, and Semimembranosus.\n` +
        `- **Leg & Foot:** [Focus: Gastrocnemius medial (left)], [Focus: Soleus (left)], [Focus: Tibialis anterior (right)], and toe extensors.\n\n` +
        `*The 12 extraocular eye muscles are organized under [Focus: Sensory] to present an intact visual orbit.*`;
    } else {
      return `### Male Muscular System Overview\n\n` +
        `The male body model features **669 full-body skeletal muscles** spanning from the cranial mimetic muscles to the intrinsic foot musculature:\n\n` +
        `- **Torso & Chest:** Pectoralis major/minor, rectus abdominis, external/internal obliques, and latissimus dorsi.\n` +
        `- **Shoulder & Arm:** Deltoids, biceps brachii, triceps brachii, and forearm flexor/extensor compartments.\n` +
        `- **Pelvis & Lower Extremity:** Quadriceps, hamstrings, gluteals, and triceps surae.\n\n` +
        `*Try separating parts with the slider at the bottom to explore deep muscle layers!*`;
    }
  }

  if (q.includes('eye') || q.includes('sensory') || q.includes('extraocular') || q.includes('vision')) {
    return `### Visual & Ophthalmic Apparatus\n\n` +
      `The sensory system in this atlas showcases high-resolution ocular anatomy:\n\n` +
      `- **Ocular Tunics:** Outer fibrous tunic (cornea & sclera), middle vascular uvea (iris, ciliary body, choroid), and inner neural retina.\n` +
      `- **Refractive Media:** Cornea, aqueous humor, crystalline lens, and vitreous body.\n` +
      `- **Extraocular Motility:** All 6 recti and oblique muscles that control conjugate gaze.\n\n` +
      `**Mnemonic for Innervation:**\n` +
      `**LR6 SO4 R3**\n` +
      `- **LR6:** Lateral Rectus -> CN VI (Abducens nerve)\n` +
      `- **SO4:** Superior Oblique -> CN IV (Trochlear nerve)\n` +
      `- **R3:** All other muscles (Medial/Superior/Inferior recti & Inferior oblique) -> CN III (Oculomotor nerve)`;
  }

  if (q.includes('reproductive') || q.includes('uterus') || q.includes('ovary')) {
    return `### Female Reproductive Anatomy (HuBMAP HRA)\n\n` +
      `Derived from high-precision HuBMAP anatomical data:\n\n` +
      `- **Uterus:** Thick muscular organ ([Focus: Body of uterus]) with endometrium, myometrium, and perimetrium.\n` +
      `- **Ovaries:** Dual endocrine and gametogenic organs ([Focus: Left ovary] and [Focus: Right ovary]).\n` +
      `- **Ligamentous Support:** Broad ligament (mesometrium, mesosalpinx, mesovarium), round ligament of uterus, and suspensory ligaments.\n` +
      `- **Vascular Supply:** Uterine artery anastomosis with the ovarian artery providing collateral circulation.`;
  }

  if (q.includes('skeletal') || q.includes('bone') || q.includes('spine')) {
    return `### Human Skeletal System\n\n` +
      `The human skeleton consists of 206 bones divided into two major divisions:\n\n` +
      `1. **Axial Skeleton (80 bones):** Cranium, vertebral column (7 cervical, 12 thoracic, 5 lumbar, sacrum, coccyx), sternum, and 12 pairs of ribs.\n` +
      `2. **Appendicular Skeleton (126 bones):** Pectoral girdle (clavicle, scapula), upper limbs, pelvic girdle (ilium, ischium, pubis), and lower limbs.\n\n` +
      `**Bone Tissue Architecture:**\n` +
      `- Outer dense **cortical (compact) bone** organized into Haversian systems (osteons).\n` +
      `- Inner porous **cancellous (trabecular) bone** containing red or yellow bone marrow.`;
  }

  if (q.includes('heart') || q.includes('cardio') || q.includes('blood') || q.includes('artery') || q.includes('vein')) {
    return `### Cardiovascular System & Hemodynamics\n\n` +
      `The cardiovascular system maintains continuous perfusion through dual closed loops:\n\n` +
      `- **Systemic Circulation:** Oxygenated blood leaves the left ventricle via the ascending aorta and distributes to capillary beds.\n` +
      `- **Pulmonary Circulation:** Deoxygenated blood returns via the venae cavae into the right atrium, proceeds to right ventricle, and is pumped via pulmonary arteries to the alveolar capillary bed for gas exchange.\n\n` +
      `**Histological Structure:**\n` +
      `Blood vessels possess three concentric tunics:\n` +
      `1. *Tunica intima* (endothelial monolayer)\n` +
      `2. *Tunica media* (smooth muscle and elastic lamellae)\n` +
      `3. *Tunica externa/adventitia* (collagenous supportive sheath)`;
  }

  // Fallback clinical assistance
  return `### Anatomy AI Assistant\n\n` +
    `I am ready to help you analyze anatomical structures, muscle biomechanics, vascular territories, and clinical scenarios.\n\n` +
    `- **Selected Structure:** ${selected ? selected.name : 'None selected (click any part in 3D to inspect)'}\n` +
    `- **Active View:** ${context.body} body · ${context.system} (${context.totalStructures.toLocaleString()} structures)\n\n` +
    `**Suggested Questions to Ask:**\n` +
    `1. *"What muscles act on the knee joint?"*\n` +
    `2. *"Explain the innervation of the extraocular eye muscles."*\n` +
    `3. *"What are the clinical signs of a femoral nerve injury?"*\n` +
    `4. *"Describe the blood supply of the pelvic organs."*\n\n` +
    `*(Tip: Click any 3D structure on screen to explore its attachments, clinical correlations, and nerve supply!)*`;
}

// Direct client fallback to Google Gemini endpoint if proxy is unavailable
async function directTestGemini(key) {
  const models = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-latest'
  ];
  let lastErr = 'Failed to connect';
  for (const model of models) {
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: 'OK' }] }] })
      });
      const data = await res.json();
      if (res.ok) return { ok: true, model };
      lastErr = data.error?.message || `HTTP ${res.status}`;
      if (res.status === 400 && lastErr.toLowerCase().includes('api key')) {
        return { ok: false, error: lastErr };
      }
    } catch (e) {
      lastErr = e.message;
    }
  }
  return { ok: false, error: lastErr };
}

// Test API Key connection
async function testGeminiKey(keyToTest) {
  const key = (keyToTest || '').trim();
  const feedbackEl = document.getElementById('key-test-feedback');
  const testBtn = document.getElementById('test-key-btn');

  if (!key && !serverHasKey) {
    if (feedbackEl) {
      feedbackEl.hidden = false;
      feedbackEl.className = 'key-test-feedback error';
      feedbackEl.innerHTML = '❌ Please enter or paste your Gemini API key first.';
    }
    return false;
  }

  if (feedbackEl) {
    feedbackEl.hidden = false;
    feedbackEl.className = 'key-test-feedback testing';
    feedbackEl.innerHTML = '⏳ Verifying API key with Google Gemini...';
  }
  if (testBtn) testBtn.disabled = true;

  try {
    let resData = null;

    // Try Node backend proxy first (avoids browser adblocker/CORS restrictions)
    try {
      const resp = await fetch('/api/gemini/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: key || undefined })
      });
      resData = await resp.json();
    } catch (_) {
      // Fallback to direct client-side fetch if server endpoint is unavailable
      if (key) {
        resData = await directTestGemini(key);
      } else {
        throw new Error('Server proxy unreachable and no client key provided.');
      }
    }

    if (resData && resData.ok) {
      if (key) {
        geminiApiKey = key;
        if (typeof localStorage !== 'undefined') localStorage.setItem(STORAGE_KEY_GEMINI, key);
      }
      activeModelName = resData.model || 'gemini-3.6-flash';
      updateKeyStatusBadge();
      if (feedbackEl) {
        feedbackEl.className = 'key-test-feedback success';
        feedbackEl.innerHTML = `✅ <strong>Connected!</strong> Google Gemini (<em>${activeModelName}</em>) is verified and active.`;
      }
      return true;
    } else {
      const errMsg = resData?.error || 'Authentication failed. Please verify your key.';
      if (feedbackEl) {
        feedbackEl.className = 'key-test-feedback error';
        feedbackEl.innerHTML = `❌ <strong>Connection Failed:</strong> ${errMsg}<br><small>Tip: Verify your key at <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener">Google AI Studio</a>.</small>`;
      }
      return false;
    }
  } catch (err) {
    if (feedbackEl) {
      feedbackEl.className = 'key-test-feedback error';
      feedbackEl.innerHTML = `❌ <strong>Connection Error:</strong> ${err.message}`;
    }
    return false;
  } finally {
    if (testBtn) testBtn.disabled = false;
  }
}

// Call Google Gemini API (Generative AI)
async function callGeminiApi(userPrompt, context) {
  const apiKey = (geminiApiKey || '').trim();
  if (!apiKey && !serverHasKey) throw new Error('NO_API_KEY');

  const selectedInfo = context.selected
    ? `Currently Selected 3D Structure: ${context.selected.name} (${context.selected.system} system, Latin: ${context.selected.latin || 'N/A'}, Note: ${context.selected.note || 'N/A'})`
    : `Currently Selected 3D Structure: None selected (viewing full ${context.system} system)`;

  const systemInstruction = `You are the Expert Anatomy Lab AI Professor & Senior Clinical Anatomist inside an interactive 3D WebGL human atlas.
You specialize in human gross anatomy, neuroanatomy, musculoskeletal biomechanics, organ physiology, embryology, surgical anatomy, and clinical pathology.
Tone: Medical-grade accuracy, engaging, clear, concise, and pedagogical.
Format: Use markdown with bold headings, bullet points, and concise tables when comparing structures.
Spatial Feature: When you reference a specific anatomical structure that exists in the atlas, wrap it like [Focus: Structure Name] (e.g. [Focus: Rectus femoris] or [Focus: Left ovary]) so the user can click it to locate and highlight it in 3D.
Keep answers structured and avoid overly long walls of text.

Current 3D Atlas State:
- Sex / Body Reference: ${context.body}
- Anatomical System: ${context.system}
- Total Visible Structures: ${context.totalStructures}
- ${selectedInfo}`;

  // Build message history
  const contents = [];
  const recentHistory = chatMessages.slice(-6);
  for (const m of recentHistory) {
    contents.push({
      role: m.role === 'user' ? 'user' : 'model',
      parts: [{ text: m.text }]
    });
  }
  contents.push({
    role: 'user',
    parts: [{ text: userPrompt }]
  });

  const payload = {
    key: apiKey,
    contents,
    systemInstruction: {
      parts: [{ text: systemInstruction }]
    },
    generationConfig: {
      temperature: 0.35,
      maxOutputTokens: 1024
    }
  };

  // 1. Try server proxy endpoint first
  try {
    const response = await fetch('/api/gemini/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const resData = await response.json();
    if (response.ok && resData.ok && resData.text) {
      activeModelName = resData.model || 'gemini-3.6-flash';
      return resData.text;
    }
    if (resData.error) {
      throw new Error(resData.error);
    }
  } catch (proxyErr) {
    if (proxyErr.message && !proxyErr.message.toLowerCase().includes('fetch')) {
      throw proxyErr;
    }
  }

  // 2. Direct client fallback across candidate models
  const candidateModels = [
    'gemini-3.6-flash',
    'gemini-3.5-flash',
    'gemini-3.8-flash',
    'gemini-3.7-flash',
    'gemini-3.1-flash-lite',
    'gemini-3.5-flash-lite',
    'gemini-3-flash-preview',
    'gemini-flash-latest'
  ];
  let lastErr = null;
  for (const model of candidateModels) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents,
          systemInstruction: { parts: [{ text: systemInstruction }] },
          generationConfig: { temperature: 0.35, maxOutputTokens: 1024 }
        })
      });

      const data = await response.json();
      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          activeModelName = model;
          return text;
        }
      }

      lastErr = data.error?.message || `HTTP ${response.status}`;
      if (response.status === 400 && lastErr.toLowerCase().includes('api key')) {
        throw new Error(lastErr);
      }
    } catch (err) {
      lastErr = err.message;
    }
  }

  throw new Error(lastErr || 'Empty response received from Gemini.');
}

// Append message to UI
function appendMessage(role, text, isError = false) {
  chatMessages.push({ role, text });
  const container = document.getElementById('ai-messages');
  if (!container) return;

  const msgDiv = document.createElement('div');
  msgDiv.className = `ai-msg ai-msg-${role}` + (isError ? ' ai-msg-error' : '');

  const iconDiv = document.createElement('div');
  iconDiv.className = 'ai-msg-avatar';
  iconDiv.textContent = role === 'user' ? '👤' : '✨';

  const bubbleDiv = document.createElement('div');
  bubbleDiv.className = 'ai-msg-bubble';
  bubbleDiv.innerHTML = formatMarkdown(text);

  // Wire up any focus pill buttons
  bubbleDiv.querySelectorAll('.ai-focus-pill').forEach(btn => {
    btn.onclick = () => {
      const partName = btn.dataset.part;
      if (partName && chatCallbacks.focusPartByName) {
        const found = chatCallbacks.focusPartByName(partName);
        if (!found) {
          btn.textContent = `Structure "${partName}" in different system`;
        }
      }
    };
  });

  msgDiv.append(iconDiv, bubbleDiv);
  container.append(msgDiv);
  container.scrollTop = container.scrollHeight;
}

// Dynamic Suggestion Chips
function updateSuggestionChips() {
  const container = document.getElementById('ai-suggestions');
  if (!container) return;
  container.replaceChildren();

  const ctx = chatCallbacks.getContext();
  const chips = [];

  if (ctx.selected) {
    chips.push(`What is the action of ${ctx.selected.name}?`);
    chips.push(`Innervation & arterial supply of ${ctx.selected.name}`);
    chips.push(`Clinical correlations / injuries for this`);
  } else if (ctx.system === 'Muscular') {
    chips.push('Explain the muscle compartments shown here');
    chips.push('What are the major muscle origins and insertions?');
    chips.push('Which nerve roots innervate these muscles?');
  } else if (ctx.system === 'Sensory') {
    chips.push('Explain the 6 extraocular eye muscles');
    chips.push('What is the LR6 SO4 R3 innervation rule?');
    chips.push('How does the retina process light signals?');
  } else if (ctx.system === 'Reproductive') {
    chips.push('Explain the female pelvic ligaments');
    chips.push('What is the blood supply to the uterus and ovaries?');
  } else {
    chips.push('Summarize the structures visible on screen');
    chips.push('What are the primary clinical landmarks here?');
    chips.push('Explain the biomechanics of this region');
  }

  for (const text of chips) {
    const chipBtn = document.createElement('button');
    chipBtn.type = 'button';
    chipBtn.className = 'ai-chip';
    chipBtn.textContent = text;
    chipBtn.onclick = () => {
      document.getElementById('ai-input').value = text;
      handleSendMessage();
    };
    container.append(chipBtn);
  }
}

// Handle Send
async function handleSendMessage() {
  if (isGenerating) return;
  const inputEl = document.getElementById('ai-input');
  const text = inputEl.value.trim();
  if (!text) return;

  inputEl.value = '';
  appendMessage('user', text);
  isGenerating = true;

  const sendBtn = document.getElementById('ai-send-btn');
  if (sendBtn) sendBtn.disabled = true;

  const statusText = document.getElementById('ai-status-text');
  if (statusText) statusText.textContent = 'Thinking…';

  const container = document.getElementById('ai-messages');
  const typingIndicator = document.createElement('div');
  typingIndicator.className = 'ai-msg ai-msg-model ai-typing';
  typingIndicator.innerHTML = '<div class="ai-msg-avatar">✨</div><div class="ai-msg-bubble"><div class="typing-dots"><span></span><span></span><span></span></div></div>';
  container.append(typingIndicator);
  container.scrollTop = container.scrollHeight;

  const ctx = chatCallbacks.getContext();

  try {
    let answer = '';
    if ((geminiApiKey && geminiApiKey.trim().length > 10) || serverHasKey) {
      answer = await callGeminiApi(text, ctx);
    } else {
      answer = generateLocalResponse(text, ctx);
    }
    typingIndicator.remove();
    appendMessage('model', answer);
  } catch (err) {
    typingIndicator.remove();
    console.warn('Gemini API call failed, falling back to offline engine:', err.message);
    const fallbackAnswer = generateLocalResponse(text, ctx);
    const note = err.message === 'NO_API_KEY'
      ? fallbackAnswer
      : `> ⚠️ **Gemini Notice:** *${err.message}*\n> *Switched to built-in medical anatomy engine:*\n\n` + fallbackAnswer;
    appendMessage('model', note);
  } finally {
    isGenerating = false;
    if (sendBtn) sendBtn.disabled = false;
    updateKeyStatusBadge();
    updateSuggestionChips();
  }
}

function updateKeyStatusBadge() {
  const badge = document.getElementById('key-status-badge');
  const statusText = document.getElementById('ai-status-text');
  const isConnected = Boolean((geminiApiKey && geminiApiKey.trim().length > 10) || serverHasKey);

  if (badge) {
    badge.textContent = isConnected ? `✨ Gemini Active (${activeModelName})` : 'Default Medical Engine';
    badge.className = isConnected ? 'key-badge key-badge-active' : 'key-badge';
  }
  if (statusText) {
    statusText.textContent = isConnected ? `Gemini · ${activeModelName}` : 'Built-in Anatomy Engine';
  }
}

function appendWelcomeMessage() {
  const ctx = chatCallbacks.getContext();
  const text = `👋 **Welcome to Anatomy AI!**\n\n` +
    `I am your interactive clinical anatomy tutor, grounded in this 3D atlas. You can:\n\n` +
    `- **Click any organ or muscle** in 3D to ask about its attachments, nerve roots, and blood supply.\n` +
    `- **Ask clinical questions** (e.g. *"What happens if the femoral nerve is damaged?"*).\n` +
    `- **Click [Focus] pills** in my responses to locate structures automatically in 3D!\n\n` +
    `*Currently viewing: **${ctx.body.toUpperCase()}** body · **${ctx.system}**.* What would you like to explore?`;
  appendMessage('model', text);
}

function updateAIContextBanner() {
  const banner = document.getElementById('ai-context-text');
  if (!banner) return;
  const ctx = chatCallbacks.getContext();
  if (ctx.selected) {
    banner.textContent = `${ctx.body.toUpperCase()} · ${ctx.system} · 📌 ${ctx.selected.name}`;
  } else {
    banner.textContent = `${ctx.body.toUpperCase()} · ${ctx.system} (${ctx.totalStructures.toLocaleString()} structures)`;
  }
}

export function updateAIContext() {
  updateAIContextBanner();
  if (isOpen) {
    updateSuggestionChips();
  }
}

// Public API
export function initAIChat(callbacks) {
  chatCallbacks = callbacks;

  const chatbox = document.getElementById('ai-chatbox');
  const toggleBtn = document.getElementById('ai-toggle');
  const closeBtn = document.getElementById('ai-close-btn');
  const clearBtn = document.getElementById('ai-clear-btn');
  const form = document.getElementById('ai-form');
  const input = document.getElementById('ai-input');
  const askPartBtn = document.getElementById('ai-ask-part');

  // Check server status (e.g. if server has GEMINI_API_KEY in .env)
  fetch('/api/gemini/status')
    .then(r => r.json())
    .then(data => {
      if (data && data.hasServerKey) {
        serverHasKey = true;
        if (data.defaultModel) activeModelName = data.defaultModel;
        updateKeyStatusBadge();
      }
    })
    .catch(() => {});

  updateKeyStatusBadge();

  function toggleChat(forceOpen) {
    isOpen = typeof forceOpen === 'boolean' ? forceOpen : !isOpen;
    if (chatbox) chatbox.hidden = !isOpen;
    if (toggleBtn) {
      toggleBtn.setAttribute('aria-expanded', String(isOpen));
      toggleBtn.classList.toggle('active', isOpen);
    }
    if (isOpen) {
      updateAIContextBanner();
      updateSuggestionChips();
      setTimeout(() => input?.focus(), 100);
    }
  }

  if (toggleBtn) toggleBtn.onclick = () => toggleChat();
  if (closeBtn) closeBtn.onclick = () => toggleChat(false);

  if (clearBtn) {
    clearBtn.onclick = () => {
      chatMessages = [];
      const msgs = document.getElementById('ai-messages');
      if (msgs) msgs.replaceChildren();
      appendWelcomeMessage();
    };
  }

  if (form) {
    form.onsubmit = e => {
      e.preventDefault();
      handleSendMessage();
    };
  }

  if (input) {
    input.onkeydown = e => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        handleSendMessage();
      }
    };
  }

  if (askPartBtn) {
    askPartBtn.onclick = () => {
      const ctx = chatCallbacks.getContext();
      if (ctx.selected) {
        toggleChat(true);
        input.value = `Explain the anatomy, function, innervation, and clinical significance of ${ctx.selected.name}.`;
        handleSendMessage();
      }
    };
  }

  // Initial welcome message
  appendWelcomeMessage();
  updateAIContextBanner();
}
