// Google Gemini API – direkt aus dem Browser, mit dem lokal gespeicherten API-Key.
const ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/models';
const TIMEOUT_MS = 60000;

const ITEM_SCHEMA = {
  type: 'OBJECT',
  properties: {
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          name: { type: 'STRING' },
          category: { type: 'STRING' },
          confidence: { type: 'NUMBER' },
        },
        required: ['name', 'category'],
      },
    },
  },
  required: ['items'],
};

async function call(settings, body) {
  const key = (settings.apiKey || '').trim();
  if (!key) throw new Error('Kein API-Key hinterlegt. Trage ihn unter Einstellungen ein.');
  if (!navigator.onLine) throw new Error('Offline – die Bilderkennung braucht eine Internetverbindung.');

  const model = settings.model || 'gemini-2.5-flash';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${ENDPOINT}/${encodeURIComponent(model)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Zeitüberschreitung – Gemini hat nicht geantwortet.');
    throw new Error('Netzwerkfehler beim Aufruf der Gemini-API.');
  } finally {
    clearTimeout(timer);
  }

  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (_) { void _; }

  if (!res.ok) {
    const msg = json?.error?.message || raw.slice(0, 300) || `HTTP ${res.status}`;
    if (res.status === 400 && /API key/i.test(msg)) throw new Error('API-Key wird abgelehnt. Bitte in den Einstellungen prüfen.');
    if (res.status === 403) throw new Error(`Zugriff verweigert: ${msg}`);
    if (res.status === 429) throw new Error('Kontingent erschöpft (429). Später erneut versuchen oder ein anderes Modell wählen.');
    // Google nennt in dieser Meldung meist gleich das Nachfolgemodell – deshalb weiterreichen.
    if (res.status === 404) throw new Error(`Modell "${settings.model}" nicht verfügbar. ${msg}`);
    throw new Error(`Gemini-Fehler ${res.status}: ${msg}`);
  }

  const block = json?.promptFeedback?.blockReason;
  if (block) throw new Error(`Anfrage von Gemini blockiert (${block}).`);

  const cand = json?.candidates?.[0];
  const text = cand?.content?.parts?.map(p => p.text).filter(Boolean).join('') || '';
  if (!text) {
    const fr = cand?.finishReason;
    throw new Error(fr ? `Keine Antwort erhalten (${fr}).` : 'Keine Antwort von Gemini erhalten.');
  }
  return text;
}

function parseItems(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch (_) {
    void _;
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Antwort von Gemini war nicht lesbar.');
    data = JSON.parse(m[0]);
  }
  const list = Array.isArray(data?.items) ? data.items : [];
  return list
    .map(x => ({
      name: String(x?.name || '').trim(),
      category: String(x?.category || '').trim(),
      confidence: typeof x?.confidence === 'number' ? Math.max(0, Math.min(1, x.confidence)) : null,
    }))
    .filter(x => x.name);
}

function catBlock(categories) {
  return categories.length
    ? `Bereits vorhandene Kategorien: ${categories.map(c => `"${c}"`).join(', ')}.
Wenn eine davon passt, gib sie ZEICHENGENAU so zurück. Nur wenn keine passt, erfinde eine neue, kurze deutsche Kategorie (ein bis zwei Wörter).`
    : 'Es gibt noch keine Kategorien. Erfinde eine passende, kurze deutsche Kategorie (ein bis zwei Wörter).';
}

/** Erkennt einen oder mehrere Gegenstände auf einem Foto. */
export async function analyzePhoto(settings, base64Jpeg, hint, categories) {
  const prompt = `Du hilfst beim Erfassen eines privaten Haushalts-Inventars.

Analysiere das Foto und liste die darauf sichtbaren Gegenstände auf, die jemand als Inventar erfassen würde.

Regeln:
- Erfasse mehrere Gegenstände einzeln, wenn sie klar voneinander unterscheidbar sind.
- Zeigt das Foto offensichtlich EINEN Hauptgegenstand, gib genau einen Eintrag zurück.
- Ignoriere Hintergrund, Möbel, Wände, Böden, Hände und Verpackungsmaterial, sofern sie nicht selbst der Gegenstand sind.
- Fasse gleichartige Dinge, die als Set zusammengehören, zu einem Eintrag zusammen (z. B. "Schraubenzieher-Set").
- Maximal 8 Einträge.
- "name": kurze deutsche Bezeichnung. Ist eine Marke oder ein Modell klar lesbar, nimm sie mit auf (z. B. "Akkuschrauber Bosch PSR 18"), sonst nur die Gattung (z. B. "Akkuschrauber").
- "category": ${catBlock(categories)}
- "confidence": Wert zwischen 0 und 1, wie sicher du dir bei der Erkennung bist.
${hint ? `\nDer Nutzer gibt diesen Hinweis, er hat Vorrang vor deiner eigenen Einschätzung: "${hint}"` : ''}`;

  const text = await call(settings, {
    contents: [{
      role: 'user',
      parts: [
        { text: prompt },
        { inline_data: { mime_type: 'image/jpeg', data: base64Jpeg } },
      ],
    }],
    generationConfig: {
      temperature: 0.2,
      responseMimeType: 'application/json',
      responseSchema: ITEM_SCHEMA,
    },
  });

  const items = parseItems(text);
  if (!items.length) throw new Error('Auf dem Foto wurde nichts Erfassbares erkannt.');
  return items;
}

/** Schlägt zu einem eingetippten Namen nur die Kategorie vor. */
export async function suggestCategory(settings, name, categories) {
  const prompt = `Ordne den folgenden Haushaltsgegenstand einer Kategorie zu: "${name}".

${catBlock(categories)}

Gib genau einen Eintrag zurück: "name" ist unverändert "${name}", "category" die passende Kategorie.`;

  const text = await call(settings, {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { temperature: 0.1, responseMimeType: 'application/json', responseSchema: ITEM_SCHEMA },
  });
  const items = parseItems(text);
  return items[0]?.category || '';
}

// Modelle, die es zwar gibt, die für diese App aber nichts taugen
// (Sprachausgabe, Bildgenerierung, Einbettungen, Spezialagenten).
const MODEL_BLOCKLIST = /tts|image|embedding|lyria|transcribe|robotics|computer-use|deep-research|antigravity|nano-banana|gemma/i;

/** Holt die für diesen Key tatsächlich freigeschalteten Modelle. */
export async function listModels(settings) {
  const key = (settings.apiKey || '').trim();
  if (!key) throw new Error('Kein API-Key hinterlegt.');
  if (!navigator.onLine) throw new Error('Offline – die Modellliste braucht eine Internetverbindung.');

  const res = await fetch(`${ENDPOINT}?pageSize=200`, { headers: { 'x-goog-api-key': key } })
    .catch(() => { throw new Error('Netzwerkfehler beim Laden der Modellliste.'); });

  const raw = await res.text();
  let json = null;
  try { json = raw ? JSON.parse(raw) : null; } catch (_) { void _; }
  if (!res.ok) throw new Error(json?.error?.message || `HTTP ${res.status}`);

  return (json?.models || [])
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map(m => ({ id: String(m.name || '').replace(/^models\//, ''), label: m.displayName || '' }))
    .filter(m => m.id && !MODEL_BLOCKLIST.test(m.id))
    .sort((a, b) => a.id.localeCompare(b.id, 'de'));
}

/** Kleiner Testaufruf für die Einstellungen. */
export async function testConnection(settings) {
  const text = await call(settings, {
    contents: [{ role: 'user', parts: [{ text: 'Antworte mit genau dem Wort: OK' }] }],
    generationConfig: { temperature: 0, maxOutputTokens: 2000 },
  });
  return text.trim();
}
