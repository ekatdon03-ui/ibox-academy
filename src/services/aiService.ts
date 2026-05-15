import { GoogleGenAI, Type } from "@google/genai";

let genAI: any = null;
const TEXT_MODEL = "gemini-2.5-flash";
const IMAGE_MODEL = "gemini-2.0-flash-exp";

function getGenAI() {
  if (!genAI) {
    const isBrowser = typeof window !== 'undefined';
    if (isBrowser) {
      // Always use server proxy in browser:
      // – bypasses Russian ISP blocks (requests go browser → our server → Google)
      // – keeps the real API key on the server, not in the JS bundle
      genAI = new GoogleGenAI({
        apiKey: 'proxy',
        httpOptions: { baseUrl: window.location.origin + '/api/ai-proxy' }
      });
    } else {
      const apiKey = process.env.GEMINI_API_KEY;
      if (!apiKey) throw new Error("GEMINI_API_KEY is not set on server.");
      genAI = new GoogleGenAI({ apiKey });
    }
  }
  return genAI;
}

function cleanContext(context: string): string {
  return context.replace(/data:image\/[^;]+;base64,[^"'\s)]+/g, '[IMAGE_REMOVED]');
}

// Trim AI response to max 3 short paragraphs (~200 words)
function trimResponse(text: string): string {
  if (!text) return text;
  const paragraphs = text.split(/\n{2,}/).map(p => p.trim()).filter(Boolean);
  return paragraphs.slice(0, 3).join('\n\n');
}

const BREVITY_RULE = `
ВАЖНО: Отвечай СТРОГО в пределах 2-3 абзацев, не более 150 слов. Никакой воды и длинных списков. Краткость — приоритет.`;

export const aiService = {
  async trainingTutor(message: string, courseContext: string, history: any[] = [], customPrompt?: string) {
    const ai = getGenAI();
    const cleanCont = cleanContext(courseContext);
    const systemInstruction = (customPrompt || `Ты — Эксперт-наставник iBOX Academy.
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

    const chat = ai.chats.create({
      model: TEXT_MODEL,
      config: {
        systemInstruction,
        maxOutputTokens: 350,
        temperature: 0.7
      },
      history: history.length > 0 ? history : []
    });

    const result = await chat.sendMessage(message);
    return trimResponse(result.text);
  },

  async smartAssistant(question: string, context: string, history: any[] = [], customPrompt?: string) {
    const ai = getGenAI();
    const cleanCont = cleanContext(context);
    const systemInstruction = (customPrompt || `Ты — Smart Assistant Академии iBOX. Отвечай только по базе знаний ниже.

    ПРАВИЛА:
    1. Отвечай строго по предоставленным материалам.
    2. Если ответа нет — скажи: "Информации по этому вопросу нет в материалах Академии."
    3. Не отвечай на вопросы, не связанные с обучением iBOX.
    4. Используй Markdown для оформления.`)
    + BREVITY_RULE
    + `\n\nБАЗА ЗНАНИЙ:\n${cleanCont}`;

    const chat = ai.chats.create({
      model: TEXT_MODEL,
      config: {
        systemInstruction,
        maxOutputTokens: 350,
        temperature: 0.5
      },
      history: history.length > 0 ? history : []
    });

    const result = await chat.sendMessage(question);
    return trimResponse(result.text);
  },

  async generateImage(prompt: string) {
    const ai = getGenAI();
    try {
      const response = await ai.models.generateContent({
        model: IMAGE_MODEL,
        contents: prompt,
        config: {
          responseModalities: ['Text', 'Image']
        }
      });

      for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
          return `data:${part.inlineData.mimeType};base64,${part.inlineData.data}`;
        }
      }
      return null;
    } catch (e) {
      console.error("Image generation failed", e);
      return null;
    }
  },

  async generateGlossaryDraft(term: string, courseContext: string) {
    const ai = getGenAI();
    try {
      const cleanCont = cleanContext(courseContext);
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: `На основе материала: ${cleanCont.substring(0, 3000)}, напиши краткое (1 предложение) определение термина "${term}". Только текст определения без форматирования.`,
      });
      return response.text;
    } catch (e) {
      console.error("Glossary draft failed", e);
      return null;
    }
  },

  async askTutor(question: string, context: string, systemPrompt?: string) {
    const ai = getGenAI();
    const cleanCont = cleanContext(context);
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: question,
      config: {
        systemInstruction: (systemPrompt || "Ты — помощник Академии iBOX. Отвечай кратко, 2-3 абзаца максимум. Используй Markdown.")
          + `\n\nCONTEXT: ${cleanCont}`,
        maxOutputTokens: 350
      }
    });
    return trimResponse(response.text);
  },

  async generateCourseFromTopic(topic: string) {
    return this.generateCourseContent(`Создай профессиональный курс на тему: ${topic}.`);
  },

  async generateCourseFromText(text: string) {
    return this.generateCourseContent(`Преобразуй текст в курс с 3-5 уроками: ${text}`);
  },

  async generateCourseContent(prompt: string) {
    const ai = getGenAI();
    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: `ТЫ — МЕТОДОЛОГ iBOX. Создай обучающий курс.

      ЗАПРОС: ${prompt}

      ТРЕБОВАНИЯ:
      1. 3-5 уроков с подробным контентом (минимум 200 слов на урок).
      2. Структура с заголовками, списками.
      3. Практические алгоритмы и речевые модули.
      4. Тест: минимум 5 вопросов с 4 вариантами ответов.

      Формат: JSON строго по схеме.`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["title", "description", "category", "lessons", "testConfig"],
          properties: {
            title: { type: Type.STRING },
            description: { type: Type.STRING },
            category: { type: Type.STRING },
            lessons: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                required: ["id", "title", "content"],
                properties: {
                  id: { type: Type.STRING },
                  title: { type: Type.STRING },
                  content: { type: Type.STRING }
                }
              }
            },
            testConfig: {
              type: Type.OBJECT,
              required: ["type", "questions"],
              properties: {
                type: { type: Type.STRING },
                questions: {
                  type: Type.ARRAY,
                  items: {
                    type: Type.OBJECT,
                    required: ["question", "options", "correctAnswer"],
                    properties: {
                      question: { type: Type.STRING },
                      options: { type: Type.ARRAY, items: { type: Type.STRING } },
                      correctAnswer: { type: Type.INTEGER }
                    }
                  }
                }
              }
            }
          }
        }
      }
    });

    return JSON.parse(response.text.trim());
  },

  async extractContentFromMedia(base64: string, mimeType: string) {
    const ai = getGenAI();
    try {
      let normalizedMimeType = mimeType;
      if (!mimeType || mimeType === 'application/octet-stream') {
        normalizedMimeType = 'application/pdf';
      }

      const isVideo = normalizedMimeType.includes('video');
      const isPdf = normalizedMimeType.includes('pdf');
      const isImage = normalizedMimeType.includes('image');
      const fileLabel = isVideo ? 'ВИДЕО' : isPdf ? 'PDF' : isImage ? 'ИЗОБРАЖЕНИЕ' : 'ФАЙЛ';

      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [
              {
                text: `ИЗВЛЕКИ все факты, регламенты, цифры и скрипты из этого ${fileLabel} дословно. Не добавляй ничего от себя. Структурированный текст только из файла.`
              },
              { inlineData: { data: base64, mimeType: normalizedMimeType } }
            ]
          }
        ]
      });

      return response.text;
    } catch (e) {
      console.error("Knowledge extraction failed", e);
      return null;
    }
  },

  async evaluateSimulatorSession(chatHistory: any[], courseContext: string) {
    const ai = getGenAI();
    const historyText = chatHistory
      .map(m => `${m.role}: ${Array.isArray(m.parts) ? m.parts[0]?.text : m.parts}`)
      .join('\n');
    const cleanCont = cleanContext(courseContext);

    const response = await ai.models.generateContent({
      model: TEXT_MODEL,
      contents: `Оцени диалог сотрудника в тренажере iBOX Academy. Будь строгим.

      КРИТЕРИИ (сумма 100 баллов):
      1. Точность знания регламентов (0-50).
      2. Умение решать возражения без выдумок (0-30).
      3. Профессионализм (0-20).

      КОНТЕКСТ КУРСА: ${cleanCont.substring(0, 3000)}

      ДИАЛОГ:
      ${historyText}

      Верни JSON: feedback (1 предложение на русском) и score (0-100).`,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          required: ["feedback", "score"],
          properties: {
            feedback: { type: Type.STRING },
            score: { type: Type.INTEGER }
          }
        }
      }
    });

    return JSON.parse(response.text.trim());
  },

  async generateGlossaryTermFromContent(content: string) {
    const ai = getGenAI();
    try {
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: `Из этого учебного материала выдели ОДИН важный термин или аббревиатуру.

        МАТЕРИАЛ:
        ${content.substring(0, 5000)}

        Верни JSON: term, definition (1-2 предложения), category (Продукты/Продажи/Софт/Регламенты).`,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            required: ["term", "definition", "category"],
            properties: {
              term: { type: Type.STRING },
              definition: { type: Type.STRING },
              category: { type: Type.STRING }
            }
          }
        }
      });
      return JSON.parse(response.text.trim());
    } catch (e) {
      console.error("AI Glossary generation failed", e);
      return null;
    }
  }
};
