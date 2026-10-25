/**
 * Document text extraction in the browser (Module C).
 *
 * Order of preference:
 *   1. PDF with a real text layer  -> pdf.js text extraction (fast, exact)
 *   2. Scanned PDF / image         -> render pages to canvas, Tesseract.js OCR
 *
 * Everything runs client-side; the file itself is uploaded to the private
 * Supabase Storage bucket and never sent to a third-party OCR service.
 */

import type { PDFPageProxy } from 'pdfjs-dist';
import type { OcrWord } from './parse';

export interface OcrProgress {
  stage: 'reading' | 'rendering' | 'recognizing' | 'parsing' | 'done';
  progress: number;
  message: string;
}

export interface OcrEngineResult {
  text: string;
  meanConfidence: number | null;
  words: OcrWord[];
  engine: 'pdfjs-text' | 'tesseract.js';
  pages: number;
}

const MAX_OCR_PAGES = 5;
const TEXT_LAYER_THRESHOLD = 60;

function loadPdfJs() {
  return import('pdfjs-dist');
}

async function configurePdfWorker(pdfjs: typeof import('pdfjs-dist')) {
  const worker = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
}

async function renderPageToCanvas(page: PDFPageProxy): Promise<HTMLCanvasElement> {
  const viewport = page.getViewport({ scale: 2 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Could not create a canvas for PDF rendering.');
  await page.render({ canvasContext: context, viewport }).promise;
  return canvas;
}

let workerPromise: Promise<import('tesseract.js').Worker> | null = null;
let progressSink: ((progress: OcrProgress) => void) | null = null;

async function getTesseractWorker(onProgress: (progress: OcrProgress) => void) {
  if (!workerPromise) {
    progressSink = onProgress;
    workerPromise = (async () => {
      const { createWorker } = await import('tesseract.js');
      return createWorker('eng', 1, {
        logger: (message: { status: string; progress: number }) => {
          progressSink?.({
            stage: 'recognizing',
            progress: Math.max(0, Math.min(100, Math.round((message.progress ?? 0) * 100))),
            message:
              message.status === 'recognizing text'
                ? 'Recognising text…'
                : message.status.replace(/_/g, ' '),
          });
        },
      });
    })();
  } else {
    progressSink = onProgress;
  }
  return workerPromise;
}

function mergeWords(target: OcrWord[], incoming: OcrWord[]) {
  for (const word of incoming) {
    if (word.text.trim().length > 0) target.push(word);
  }
}

function meanConfidence(values: number[]): number | null {
  if (!values.length) return null;
  return Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 10) / 10;
}

export async function extractDocumentText(
  file: File,
  onProgress: (progress: OcrProgress) => void,
): Promise<OcrEngineResult> {
  onProgress({ stage: 'reading', progress: 5, message: 'Reading the uploaded file…' });

  if (file.type === 'application/pdf') {
    let pdfjs: typeof import('pdfjs-dist');
    try {
      pdfjs = await loadPdfJs();
      await configurePdfWorker(pdfjs);
    } catch {
      throw new Error('The PDF engine could not be loaded. Check your connection and retry.');
    }

    const document = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const textChunks: string[] = [];
    onProgress({ stage: 'reading', progress: 20, message: 'Extracting the PDF text layer…' });
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber);
      const content = await page.getTextContent();
      textChunks.push(
        content.items
          .map((item) => ('str' in item ? item.str : ''))
          .join(' ')
          .replace(/\s{2,}/g, ' '),
      );
    }
    const textLayer = textChunks.join('\n').trim();

    if (textLayer.replace(/\s/g, '').length >= TEXT_LAYER_THRESHOLD) {
      onProgress({ stage: 'parsing', progress: 90, message: 'Text layer found — no OCR required.' });
      return { text: textLayer, meanConfidence: null, words: [], engine: 'pdfjs-text', pages: document.numPages };
    }

    // Scanned PDF: OCR the first pages.
    const pageCount = Math.min(document.numPages, MAX_OCR_PAGES);
    const words: OcrWord[] = [];
    const texts: string[] = [];
    const confidences: number[] = [];
    for (let pageNumber = 1; pageNumber <= pageCount; pageNumber += 1) {
      onProgress({
        stage: 'rendering',
        progress: 20 + Math.round((pageNumber / pageCount) * 15),
        message: `Rendering page ${pageNumber} of ${pageCount}…`,
      });
      const page = await document.getPage(pageNumber);
      const canvas = await renderPageToCanvas(page);
      onProgress({
        stage: 'recognizing',
        progress: 30 + Math.round(((pageNumber - 1) / pageCount) * 60),
        message: `Running OCR on page ${pageNumber} of ${pageCount}…`,
      });
      const worker = await getTesseractWorker(onProgress);
      const result = await worker.recognize(canvas);
      texts.push(result.data.text);
      confidences.push(result.data.confidence);
      const pageWords = (result.data.words ?? []).map((word) => ({
        text: word.text,
        confidence: word.confidence,
      }));
      mergeWords(words, pageWords);
      canvas.width = 0;
      canvas.height = 0;
    }
    onProgress({ stage: 'parsing', progress: 95, message: 'Parsing recognised text…' });
    return {
      text: texts.join('\n'),
      meanConfidence: meanConfidence(confidences),
      words,
      engine: 'tesseract.js',
      pages: pageCount,
    };
  }

  // Image upload
  onProgress({ stage: 'recognizing', progress: 15, message: 'Preparing OCR…' });
  const worker = await getTesseractWorker(onProgress);
  const result = await worker.recognize(file);
  onProgress({ stage: 'parsing', progress: 95, message: 'Parsing recognised text…' });
  return {
    text: result.data.text,
    meanConfidence: Math.round(result.data.confidence * 10) / 10,
    words: (result.data.words ?? []).map((word) => ({ text: word.text, confidence: word.confidence })),
    engine: 'tesseract.js',
    pages: 1,
  };
}

export async function disposeOcrWorker(): Promise<void> {
  if (workerPromise) {
    const worker = await workerPromise.catch(() => null);
    workerPromise = null;
    progressSink = null;
    await worker?.terminate().catch(() => undefined);
  }
}
