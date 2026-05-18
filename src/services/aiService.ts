const TEXT_MODEL = "gemini-2.5-flash";

// ─── Rate limiter ─────────────────────────────────────────────────────────────
// Max 6 requests per 60 seconds per browser session
const RATE_LIMIT = 6;
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

const BREVITY_RULE = `\nВАЖНО: Отвечай СТРОГО в пределах 2-3 абзацев, не более 150 слов. Краткость — приоритет.`;

// ─── Core fetch helper ────────────────────────────────────────────────────────
async function geminiPost(modelPath: string, body: object): Promise<any> {
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
    const cleanCont = cleanContext(courseContext).substring(0, 5000);
    const system = (customPrompt || `Ты — Эксперт-наставник iBOX Academy.
Твоя задача: проводить реалистичные симуляции и тренировки сотрудников.

ПРАВИЛА ТРЕНИРОВКИ:
1. ИСПОЛЬЗУЙ ТОЛЬКО ЗНАНИЯ ИЗ ПРЕДОСТАВЛЕННОГО КОНТЕКСТА.
2. Не используй общие знания о мире — только материалы курса.
3. Создавай одну конкретную рабочую ситуацию за раз.
4. Если ученик ошибается — указывай на ошибку кратко и жди исправления.
5. В конце успешной тренировки обязательно напиши слово: SUCCESS.
6. Не пиши SUCCESS, пока ответ не будет правильным.`)
      + BREVITY_RULE
      + `\n\nКОНТЕКСТ КУРСА:\n${cleanCont}`;

    const text = await chatSend(message, history, system, 200);
    return trimResponse(text);
  },

  async smartAssistant(question: string, context: string, history: any[] = [], customPrompt?: string) {
    const cleanCont = cleanContext(context).substring(0, 5000);
    const system = (customPrompt || `Ты — Smart Assistant Академии iBOX. Отвечай только по базе знаний ниже.

ПРАВИЛА:
1. Отвечай строго по предоставленным материалам.
2. Если ответа нет — скажи: "Информации по этому вопросу нет в материалах Академии."
3. Не отвечай на вопросы, не связанные с обучением iBOX.
4. Используй Markdown для оформления.`)
      + BREVITY_RULE
      + `\n\nБАЗА ЗНАНИЙ:\n${cleanCont}`;

    const text = await chatSend(question, history, system, 200);
    return trimResponse(text);
  },

  async generateImage(prompt: string) {
    const fullPrompt = `Professional minimalist course cover photo for a corporate LMS. Topic: ${prompt}. Photorealistic style, clean composition, no text, no letters, no words anywhere in the image. Soft lighting, modern business aesthetic.`;
    const data = await geminiPost('gemini-2.5-flash-image:generateContent', {
      contents: [{ parts: [{ text: fullPrompt }] }],
      generationConfig: { responseModalities: ['IMAGE'] },
    });
    const parts: any[] = data?.candidates?.[0]?.content?.parts ?? [];
    const imgPart = parts.find((p: any) => p.inlineData?.data);
    if (!imgPart) throw new Error('Модель не вернула изображение');
    return `data:${imgPart.inlineData.mimeType ?? 'image/png'};base64,${imgPart.inlineData.data}`;
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
      { mimeType: 'application/json', schema, maxTokens: 2048, temp: 0.5 }
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

      return await generateContent('', {
        parts: [
          { text: `ИЗВЛЕКИ все факты, регламенты, цифры и скрипты из этого ${fileLabel} дословно. Не добавляй ничего от себя. Структурированный текст только из файла.` },
          { inlineData: { data: base64, mimeType: normalizedMimeType } }
        ],
        maxTokens: 4096,
      });
    } catch (e) {
      console.error('Knowledge extraction failed', e);
      return null;
    }
  },

  async evaluateSimulatorSession(chatHistory: any[], courseContext: string) {
    const historyText = chatHistory
      .map(m => `${m.role}: ${Array.isArray(m.parts) ? m.parts[0]?.text : m.parts}`)
      .join('\n');
    const cleanCont = cleanContext(courseContext);

    const schema = {
      type: "OBJECT",
      required: ["feedback", "score"],
      properties: {
        feedback: { type: "STRING" },
        score: { type: "INTEGER" }
      }
    };

    const text = await generateContent(
      `Оцени диалог сотрудника в тренажере iBOX Academy. Будь строгим.\n\nКРИТЕРИИ (сумма 100 баллов):\n1. Точность знания регламентов (0-50).\n2. Умение решать возражения без выдумок (0-30).\n3. Профессионализм (0-20).\n\nКОНТЕКСТ КУРСА: ${cleanCont.substring(0, 3000)}\n\nДИАЛОГ:\n${historyText}\n\nВерни JSON: feedback (1 предложение на русском) и score (0-100).`,
      { mimeType: 'application/json', schema, maxTokens: 256 }
    );
    return JSON.parse(text.trim());
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
