import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DIST_DIR = path.join(__dirname, 'dist');
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;

// Load .env file if available
try {
  const envPath = path.join(__dirname, '.env');
  if (fs.existsSync(envPath) && process.loadEnvFile) {
    process.loadEnvFile(envPath);
  } else if (fs.existsSync(envPath)) {
    // Fallback simple .env parser
    const envContent = fs.readFileSync(envPath, 'utf8');
    for (const line of envContent.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx > 0) {
        const key = trimmed.slice(0, eqIdx).trim();
        const val = trimmed.slice(eqIdx + 1).trim();
        process.env[key] = val;
      }
    }
  }
} catch (_) {}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.bin.gz': 'application/gzip',
  '.gz': 'application/gzip',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml'
};

const CANDIDATE_MODELS = [
  'gemini-3.6-flash',
  'gemini-3.5-flash',
  'gemini-3.8-flash',
  'gemini-3.7-flash',
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-3-flash-preview',
  'gemini-flash-latest'
];

function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!body.trim()) return resolve({});
      try {
        resolve(JSON.parse(body));
      } catch (e) {
        reject(new Error('Invalid JSON: ' + e.message));
      }
    });
    req.on('error', reject);
  });
}

function sendJsonResponse(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Cache-Control': 'no-cache, no-store, must-revalidate'
  });
  res.end(JSON.stringify(data));
}

async function discoverModels(apiKey) {
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
    const data = await res.json();
    if (res.ok && Array.isArray(data.models)) {
      const available = data.models
        .filter(m => m.supportedGenerationMethods?.includes('generateContent'))
        .map(m => m.name.replace(/^models\//, ''));

      if (available.length > 0) {
        // Prioritize stable working models first
        const ordered = [];
        for (const pref of CANDIDATE_MODELS) {
          if (available.includes(pref)) ordered.push(pref);
        }
        for (const other of available) {
          if (!ordered.includes(other)) ordered.push(other);
        }
        return { ok: true, models: ordered };
      }
    }
    if (data.error?.message) {
      return { ok: false, error: data.error.message };
    }
  } catch (err) {
    // Network fallback
  }
  return { ok: true, models: CANDIDATE_MODELS };
}

async function tryGeminiGenerate(apiKey, payload, specificModel = null) {
  let modelsToTry = specificModel ? [specificModel] : CANDIDATE_MODELS;

  if (!specificModel) {
    const discovered = await discoverModels(apiKey);
    if (!discovered.ok && discovered.error) {
      return { ok: false, error: discovered.error };
    }
    if (discovered.ok && discovered.models?.length > 0) {
      modelsToTry = discovered.models;
    }
  }

  let lastError = null;

  for (const model of modelsToTry) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      const responseText = await response.text();
      let data = {};
      try {
        data = JSON.parse(responseText);
      } catch (_) {}

      if (response.ok) {
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        return { ok: true, model, text, raw: data };
      }

      const errMsg = data.error?.message || `HTTP ${response.status}: ${response.statusText}`;
      lastError = errMsg;

      // If key is invalid (400 / 403 API_KEY_INVALID), trying other models won't help
      if (response.status === 400 && errMsg.toLowerCase().includes('api key')) {
        return { ok: false, error: errMsg, model };
      }
      // If 503 (high demand) or 404 (model retired), continue loop to next model!
    } catch (netErr) {
      lastError = netErr.message;
    }
  }

  return { ok: false, error: lastError || 'All candidate Gemini models failed' };
}

const server = http.createServer(async (req, res) => {
  const urlObj = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(urlObj.pathname);

  // CORS Preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    res.end();
    return;
  }

  // --- API Routes ---
  if (pathname === '/api/gemini/status' && req.method === 'GET') {
    const hasServerKey = Boolean(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.trim());
    return sendJsonResponse(res, 200, {
      ok: true,
      hasServerKey,
      defaultModel: 'gemini-3.6-flash',
      candidateModels: CANDIDATE_MODELS
    });
  }

  if (pathname === '/api/gemini/test' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const key = (body.key || process.env.GEMINI_API_KEY || '').trim();

      if (!key) {
        return sendJsonResponse(res, 400, {
          ok: false,
          error: 'No API key provided. Please paste your Google Gemini API key or set GEMINI_API_KEY in .env.'
        });
      }

      const testPayload = {
        contents: [{ role: 'user', parts: [{ text: 'Respond with exactly: OK' }] }],
        generationConfig: { maxOutputTokens: 10, temperature: 0.1 }
      };

      const result = await tryGeminiGenerate(key, testPayload);
      if (result.ok) {
        return sendJsonResponse(res, 200, {
          ok: true,
          model: result.model,
          message: `Connection successful! Connected to Google Gemini (${result.model}).`
        });
      } else {
        return sendJsonResponse(res, 400, {
          ok: false,
          error: result.error || 'Failed to authenticate with Gemini API.'
        });
      }
    } catch (err) {
      return sendJsonResponse(res, 500, { ok: false, error: err.message });
    }
  }

  if (pathname === '/api/gemini/chat' && req.method === 'POST') {
    try {
      const body = await parseJsonBody(req);
      const key = (body.key || process.env.GEMINI_API_KEY || '').trim();

      if (!key) {
        return sendJsonResponse(res, 400, {
          ok: false,
          error: 'NO_API_KEY'
        });
      }

      const payload = {
        contents: body.contents || [],
        systemInstruction: body.systemInstruction,
        generationConfig: body.generationConfig || {
          temperature: 0.35,
          maxOutputTokens: 1024
        }
      };

      const result = await tryGeminiGenerate(key, payload);
      if (result.ok) {
        return sendJsonResponse(res, 200, {
          ok: true,
          model: result.model,
          text: result.text
        });
      } else {
        return sendJsonResponse(res, 400, {
          ok: false,
          error: result.error
        });
      }
    } catch (err) {
      return sendJsonResponse(res, 500, { ok: false, error: err.message });
    }
  }

  // --- Static Files ---
  let safePath = pathname;
  if (safePath === '/' || safePath === '') safePath = '/index.html';

  const filePath = path.join(DIST_DIR, safePath);

  // Security check: ensure path stays within DIST_DIR
  if (!filePath.startsWith(DIST_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.stat(filePath, (err, stats) => {
    if (err || !stats.isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not Found: ' + safePath);
      return;
    }

    let ext = path.extname(filePath).toLowerCase();
    if (filePath.endsWith('.bin.gz')) {
      ext = '.bin.gz';
    }
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': stats.size,
      'Access-Control-Allow-Origin': '*',
      'Cache-Control': 'no-cache, no-store, must-revalidate'
    });

    fs.createReadStream(filePath).pipe(res);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`Anatomy Lab server running at http://localhost:${PORT}/`);
});
