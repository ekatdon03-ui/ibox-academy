// ─────────────────────────────────────────────────────────────────────────────
// Moodle XML question-bank parser.
// Converts a Moodle "quiz" XML export into our QuizQuestion[] shape:
//   { question: string, options: string[], correctAnswer: number }
// Supports: multichoice (single answer), truefalse. Skips category/essay/etc.
// ─────────────────────────────────────────────────────────────────────────────
import { XMLParser } from 'fast-xml-parser';

function stripHtml(s: any): string {
  if (s == null) return '';
  let t = String(s);
  t = t.replace(/<br\s*\/?>/gi, ' ').replace(/<\/p>/gi, ' ');
  t = t.replace(/<[^>]+>/g, '');
  t = t.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<')
       .replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  return t.replace(/\s+/g, ' ').trim();
}

// A Moodle <text> node may be a string or { '#text': ... } depending on attrs.
function textOf(node: any): string {
  if (node == null) return '';
  if (typeof node === 'string' || typeof node === 'number') return stripHtml(node);
  if (node['#text'] != null) return stripHtml(node['#text']);
  if (node.text != null) return textOf(node.text);
  return '';
}

function fractionOf(answer: any): number {
  const f = answer?.['@_fraction'] ?? answer?.fraction ?? 0;
  const n = parseFloat(String(f));
  return Number.isFinite(n) ? n : 0;
}

export interface ParsedBank {
  questions: { question: string; options: string[]; correctAnswer: number }[];
  skipped: number;
}

export function parseMoodleXml(xml: string): ParsedBank {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    cdataPropName: '#cdata',
    processEntities: true,
    trimValues: true,
  });
  const doc = parser.parse(xml);
  const quiz = doc?.quiz || doc?.QUIZ;
  if (!quiz) return { questions: [], skipped: 0 };

  let rawQuestions = quiz.question || [];
  if (!Array.isArray(rawQuestions)) rawQuestions = [rawQuestions];

  const out: ParsedBank['questions'] = [];
  let skipped = 0;

  for (const q of rawQuestions) {
    const type = String(q?.['@_type'] || q?.type || '').toLowerCase();
    if (type !== 'multichoice' && type !== 'truefalse') { skipped++; continue; }

    const questionText = textOf(q.questiontext);
    let answers = q.answer || [];
    if (!Array.isArray(answers)) answers = [answers];
    if (!answers.length || !questionText) { skipped++; continue; }

    const options: string[] = [];
    let correctAnswer = 0;
    let bestFraction = -Infinity;

    answers.forEach((a: any, i: number) => {
      const label = textOf(a);
      options.push(label || `Вариант ${i + 1}`);
      const f = fractionOf(a);
      if (f > bestFraction) { bestFraction = f; correctAnswer = i; }
    });

    if (options.length < 2) { skipped++; continue; }
    out.push({ question: questionText, options, correctAnswer });
  }

  return { questions: out, skipped };
}
