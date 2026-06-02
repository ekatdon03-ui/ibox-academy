const TEXT_MODEL = "gemini-2.5-flash";

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// Max 20 requests per 60 seconds per browser session
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60_000;
const requestTimestamps: number[] = [];

function checkRateLimit() {
  const now = Date.now();
  // Remove timestamps older than the window
  while (requestTimestamps.length > 0 && requestTimestamps[0] < now - RATE_WINDOW_MS) {
    requestTimestamps.shift();
  }
  if (requestTimestamps.length >= RATE_LIMIT) {
    const waitSec = Math.ceil((requestTimestamps[0] + RATE_WINDOW_MS - now) / 1000);
    throw new Error(`Слишком много запросов к ИИ. Подождите ${waitSec} сек.`);
  }
  requestTimestamps.push(now);
}

// In the browser all requests go through our server proxy → Google Gemini.
// This bypasses Russian ISP blocks and keeps the real API key on the server.
// On the server (SSR/build) we talk to Google directly.
function proxyBase(): string {
  if (typeof window !== 'undefined') {
    return window.location.origin + '/api/ai-proxy';
  }
  return 'https://generativelanguage.googleapis.com';
}

function apiKey(): string {
  if (typeof window !== 'undefined') return 'placeholder'; // server replaces it
  return process.env.GEMINI_API_KEY || '';
}

function cleanContext(context: string): string {
  return context.replace(/data:image\/[^;]+;base64,[^"'\s)]+/g, '[IMAGE_REMOVED]');
}

function trimResponse(text: string): string {
  if (!text) return text;
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return paragraphs.slice(0, 3).join('\n\n');
}

// Used only for the assistant, not the simulator tutor
const BREVITY_RULE = `\nВАЖНО: Отвечай кратко и по делу, не более 300 слов.`;

// ─── Core fetch helper ────────────────────────────────────────────────────────
async function geminiPost(modelPath: string, body: object, attempt = 0): Promise<any> {
  checkRateLimit();
  const base = proxyBase();
  const key = apiKey();
  const url = `${base}/v1beta/models/${modelPath}?key=${key}`;

  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': key,
    },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    // Retry on 503 (overload) and 429 (rate limit) up to 3 times with backoff
    if ((resp.status === 503 || resp.status === 429) && attempt < 3) {
      const delay = (attempt + 1) * 3000; // 3s, 6s, 9s
      await new Promise(r => setTimeout(r, delay));
      return geminiPost(modelPath, body, attempt + 1);
    }
    if (resp.status === 403) {
      throw new Error('API ключ Gemini недействителен или заблокирован. Администратору необходимо создать новый ключ на aistudio.google.com и обновить его на сервере.');
    }
    const text = await resp.text();
    throw new Error(`Gemini ${resp.status}: ${text.slice(0, 400)}`);
  }
  return resp.json();
}

async function generateContent(prompt: string, opts: {
  system?: string;
  maxTokens?: number;
  temp?: number;
  mimeType?: string;
  schema?: any;
  parts?: any[];
}): Promise<string> {
  const contents = opts.parts
    ? [{ role: 'user', parts: opts.parts }]
    : [{ role: 'user', parts: [{ text: prompt }] }];

  const body: any = { contents };
  if (opts.system) body.systemInstruction = { parts: [{ text: opts.system }] };
  body.generationConfig = {
    maxOutputTokens: opts.maxTokens ?? 256,
    temperature: opts.temp ?? 0.7,
  };
  if (opts.mimeType) body.generationConfig.responseMimeType = opts.mimeType;
  if (opts.schema) body.generationConfig.responseSchema = opts.schema;

  const data = await geminiPost(`${TEXT_MODEL}:generateContent`, body);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

async function chatSend(message: string, history: any[], systemInstruction: string, maxTokens = 200): Promise<string> {
  // Build contents array: system + history + new message
  const contents: any[] = [];

  // Map SDK history format to Gemini API format
  for (const msg of history) {
    const role = msg.role === 'user' ? 'user' : 'model';
    const text = Array.isArray(msg.parts) ? (msg.parts[0]?.text ?? '') : String(msg.parts ?? '');
    if (text) contents.push({ role, parts: [{ text }] });
  }
  contents.push({ role: 'user', parts: [{ text: message }] });

  const body: any = {
    contents,
    systemInstruction: { parts: [{ text: systemInstruction }] },
    generationConfig: { maxOutputTokens: maxTokens, temperature: 0.7 },
  };

  const data = await geminiPost(`${TEXT_MODEL}:generateContent`, body);
  return data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

// ─── Public API ───────────────────────────────────────────────────────────────
export const aiService = {
  async trainingTutor(message: string, courseContext: string, history: any[] = [], customPrompt?: string) {
    const cleanCont = cleanContext(courseContext).substring(0, 20000);
    // customPrompt is the persona/style — critical system rules are always appended
    const persona = customPrompt?.trim() || `Ты — Эксперт-наставник iBOX Academy.
Твоя задача: проводить реалистичные симуляции и тренировки сотрудников.`;
    const system = persona + `

ПРАВИЛА ТРЕНИРОВКИ (ОБЯЗАТЕЛЬНЫЕ, НЕ МЕНЯТЬ):
1. ИСПОЛЬЗУЙ ТОЛЬКО ЗНАНИЯ ИЗ ПРЕДОСТАВЛЕННОГО КОНТЕКСТА.
2. Не используй общие знания о мире — только материалы курса.
3. Создавай одну конкретную рабочую ситуацию за раз.
4. Если ученик ошибается — указывай на ошибку кратко и жди исправления.
5. В конце успешной тренировки обязательно напиши слово: SUCCESS.
6. Не пиши SUCCESS, пока ответ не будет правильным.

КОНТЕКСТ КУРСА:\n${cleanCont}`;

    // 2048 tokens — enough for rich simulator dialogue turns
    return await chatSend(message, history, system, 2048);
  },

  async smartAssistant(question: string, context: string, history: any[] = [], customPrompt?: string) {
    const cleanCont = cleanContext(context).substring(0, 20000);
    // customPrompt is the persona/style — core rules always appended
    const persona = customPrompt?.trim() || `Ты — Smart Assistant Академии iBOX. Отвечай только по базе знаний ниже.`;
    const system = persona + `

ПРАВИЛА (ОБЯЗАТЕЛЬНЫЕ):
1. Отвечай строго по предоставленным материалам.
2. Если ответа нет — скажи: "Информации по этому вопросу нет в материалах Академии."
3. Не отвечай на вопросы, не связанные с обучением iBOX.
4. Используй Markdown для оформления.`
      + BREVITY_RULE
      + `\n\nБАЗА ЗНАНИЙ:\n${cleanCont}`;

    const text = await chatSend(question, history, system, 600);
    return trimResponse(text);
  },

  async generateGlossaryDraft(term: string, courseContext: string) {
    try {
      const cleanCont = cleanContext(courseContext);
      return await generateContent(
        `На основе материала: ${cleanCont.substring(0, 3000)}, напиши краткое (1 предложение) определение термина "${term}". Только текст определения без форматирования.`,
        {}
      );
    } catch (e) {
      console.error('Glossary draft failed', e);
      return null;
    }
  },

  async askTutor(question: string, context: string, systemPrompt?: string) {
    const cleanCont = cleanContext(context);
    const text = await generateContent(question, {
      system: (systemPrompt || 'Ты — помощник Академии iBOX. Отвечай кратко, 2-3 абзаца максимум. Используй Markdown.')
        + `\n\nCONTEXT: ${cleanCont}`,
      maxTokens: 256,
    });
    return trimResponse(text);
  },

  async generateCourseFromTopic(topic: string) {
    return this.generateCourseContent(`Создай профессиональный курс на тему: ${topic}.`);
  },

  async generateCourseFromText(text: string) {
    return this.generateCourseContent(`Преобразуй текст в курс с 3-5 уроками: ${text}`);
  },

  async generateCourseContent(prompt: string) {
    const schema = {
      type: "OBJECT",
      required: ["title", "description", "category", "lessons", "testConfig"],
      properties: {
        title: { type: "STRING" },
        description: { type: "STRING" },
        category: { type: "STRING" },
        lessons: {
          type: "ARRAY",
          items: {
            type: "OBJECT",
            required: ["id", "title", "content"],
            properties: {
              id: { type: "STRING" },
              title: { type: "STRING" },
              content: { type: "STRING" }
            }
          }
        },
        testConfig: {
          type: "OBJECT",
          required: ["type", "questions"],
          properties: {
            type: { type: "STRING" },
            questions: {
              type: "ARRAY",
              items: {
                type: "OBJECT",
                required: ["question", "options", "correctAnswer"],
                properties: {
                  question: { type: "STRING" },
                  options: { type: "ARRAY", items: { type: "STRING" } },
                  correctAnswer: { type: "INTEGER" }
                }
              }
            }
          }
        }
      }
    };

    const text = await generateContent(
      `ТЫ — МЕТОДОЛОГ iBOX. Создай обучающий курс.\n\nЗАПРОС: ${prompt}\n\nТРЕБОВАНИЯ:\n1. 3-5 уроков с подробным контентом (минимум 200 слов на урок).\n2. Структура с заголовками, списками.\n3. Практические алгоритмы и речевые модули.\n4. Тест: минимум 5 вопросов с 4 вариантами ответов.\n\nФормат: JSON строго по схеме.`,
      { mimeType: 'application/json', schema, maxTokens: 4096, temp: 0.5 }
    );
    return JSON.parse(text.trim());
  },

  async extractContentFromMedia(base64: string, mimeType: string) {
    try {
      let normalizedMimeType = mimeType;
      if (!mimeType || mimeType === 'application/octet-stream') normalizedMimeType = 'application/pdf';

      const isVideo = normalizedMimeType.includes('video');
      const isPdf = normalizedMimeType.includes('pdf');
      const isImage = normalizedMimeType.includes('image');
      const fileLabel = isVideo ? 'ВИДЕО' : isPdf ? 'PDF' : isImage ? 'ИЗОБРАЖЕНИЕ' : 'ФАЙЛ';

      const raw = await generateContent('', {
        parts: [
          { text: `Извлеки весь текст, факты, цифры, скрипты и структуру из этого ${fileLabel}. Включай все слайды, разделы и пункты полностью. Сохраняй исходную структуру.` },
          { inlineData: { data: base64, mimeType: normalizedMimeType } }
        ],
        maxTokens: 8192,
      });

      if (!raw) return null;

      // Strip NotebookLM footer only if it appears in the last 600 chars after a clear separator
      const tail = raw.slice(-600);
      const footerIdx = tail.search(/\n[-–—=*]{3,}\s*\n[\s\S]{0,300}NotebookLM/i);
      const cleaned = footerIdx !== -1
        ? raw.slice(0, raw.length - 600 + footerIdx).trim()
        : raw.trim();

      return cleaned || null;
    } catch (e) {
      console.error('Knowledge extraction failed', e);
      return null;
    }
  },

  async evaluateSimulatorSession(chatHistory: any[], courseContext: string) {
    // Separate user turns from AI turns for analysis
    const userTurns = chatHistory.filter(m => m.role === 'user');
    const historyText = chatHistory
      .map(m => {
        const role = m.role === 'user' ? 'СОТРУДНИК' : 'НАСТАВНИК';
        const text = Array.isArray(m.parts) ? m.parts[0]?.text : String(m.parts ?? '');
        return `${role}: ${text}`;
      })
      .join('\n\n');
    const cleanCont = cleanContext(courseContext);

    // Pre-check: if all user answers are empty / "не знаю" / single words — skip AI
    const WEAK_ANSWER = /^(не знаю|незнаю|не хочу|нехочу|хз|нет|да|ок|ok|\.+|\?+|!+|\s*)$/i;
    const allWeak = userTurns.every(m => {
      const t = (Array.isArray(m.parts) ? m.parts[0]?.text : String(m.parts ?? '')).trim();
      return WEAK_ANSWER.test(t) || t.length < 5;
    });
    if (allWeak) {
      return { score: 5, feedback: 'Сотрудник не дал ни одного содержательного ответа. Необходимо изучить материал курса и пройти тренировку повторно.' };
    }

    try {
      const text = await generateContent(
        `Ты — строгий эксперт-оценщик iBOX Academy. Оцени ТОЛЬКО ответы СОТРУДНИКА в диалоге ниже.

ОБЯЗАТЕЛЬНЫЕ ПРАВИЛА:
- Оценивай исключительно реплики "СОТРУДНИК:", игнорируй "НАСТАВНИК:".
- Начинай с 100 баллов, вычитай штрафы — прибавлять нельзя.
- "Не знаю", "нет", "да" без объяснения — штраф -25 за каждый такой ответ.
- Ответ не по теме курса или выдуманная информация — штраф -20.
- Очень короткий ответ (меньше 10 слов) без сути — штраф -15.
- Правильный полный ответ с деталями из курса — штраф 0.
- Итог НЕ МОЖЕТ быть выше реального качества ответов. Лучше занизить, чем завысить.

ДИАЛОГ (только СОТРУДНИК считается):
${historyText}

МАТЕРИАЛ КУРСА (эталон для проверки):
${cleanCont.substring(0, 3500)}

Ответь СТРОГО двумя строками без пояснений:
ОЦЕНКА: [итоговое число от 0 до 100]
ФИДБЕК: [2 предложения — конкретно что было не так и что изучить]`,
        { maxTokens: 600, temp: 0.1 }
      );

      // Score-based default feedback when AI doesn't return one
      const defaultFeedback = (s: number) => {
        if (s >= 90) return 'Отличная работа! Все ответы точные и полные по материалам курса. Продолжайте в том же духе.';
        if (s >= 70) return 'Хороший результат, основной материал усвоен. Обратите внимание на детали и проработайте слабые места.';
        if (s >= 50) return 'Есть понимание темы, но знания неполные. Повторите ключевые разделы курса и попробуйте снова.';
        if (s >= 20) return 'Знание материала недостаточное, много ошибок. Необходимо полностью повторить курс перед следующей тренировкой.';
        return 'Ответы не содержали информации из курса. Изучите материал курса полностью и пройдите тренировку снова.';
      };

      // Clean label artifacts from feedback text
      const cleanFeedback = (raw: string) =>
        raw
          .replace(/ОЦЕНКА[:\s]*\d*\s*/gi, '')
          .replace(/ФИДБЕК[:\s]*/gi, '')
          .replace(/^[-–—:]\s*/gm, '')
          .trim();

      const scoreMatch = text.match(/ОЦЕНКА[:\s]+(\d+)/i);
      // Split on ФИДБЕК label — take everything after it
      const feedbackParts = text.split(/ФИДБЕК[:\s]*/i);
      const rawFeedback = feedbackParts.length > 1 ? feedbackParts.slice(1).join(' ') : '';

      const score = scoreMatch ? Math.max(0, Math.min(100, parseInt(scoreMatch[1]))) : null;
      const feedback = cleanFeedback(rawFeedback);

      if (score !== null) {
        return { score, feedback: feedback.length > 10 ? feedback : defaultFeedback(score) };
      }

      // Last-resort fallback
      const anyNum = text.match(/\b(\d{1,3})\b/);
      const fbScore = anyNum ? Math.max(0, Math.min(100, parseInt(anyNum[1]))) : 50;
      return { score: fbScore, feedback: defaultFeedback(fbScore) };

    } catch (e) {
      console.error('Evaluation failed:', e);
      return { score: 0, feedback: 'Не удалось получить оценку от ИИ. Проверьте подключение и попробуйте снова.' };
    }
  },

  async generateGlossaryTermFromContent(content: string) {
    try {
      const schema = {
        type: "OBJECT",
        required: ["term", "definition", "category"],
        properties: {
          term: { type: "STRING" },
          definition: { type: "STRING" },
          category: { type: "STRING" }
        }
      };
      const text = await generateContent(
        `Из этого учебного материала выдели ОДИН важный термин или аббревиатуру.\n\nМАТЕРИАЛ:\n${content.substring(0, 5000)}\n\nВерни JSON: term, definition (1-2 предложения), category (Продукты/Продажи/Софт/Регламенты).`,
        { mimeType: 'application/json', schema, maxTokens: 128 }
      );
      return JSON.parse(text.trim());
    } catch (e) {
      console.error('AI Glossary generation failed', e);
      return null;
    }
  }
};
