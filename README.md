# Quiz Solver

A Linux-compatible Electron desktop app that answers multiple-choice questions captured from your screen.
Questions in Romanian, Hungarian, and English are supported (OCR defaults to `ron+hun+eng`).

**Flow:** capture a quiz question (window capture, screen capture, screenshot file, paste, or the built-in
browser) → OCR (tesseract.js) → answer model (OpenRouter) with optional user-selected reference documents →
decision model (OpenRouter) that scores confidence → answers (1 to 4 may be correct) with confidence scores.

## Features

- **Capture screen / Capture window** — pick a monitor or window via Electron's `desktopCapturer`.
- **Built-in browser** — load the quiz page in the embedded webview and capture it directly.
- **Upload or paste** a screenshot file, or paste an image from the clipboard (Ctrl+V).
- **Crop tool** — drag a rectangle around just the question for cleaner OCR.
- **Reference documents** — attach txt/md/pdf/json/csv/html files; the answer model grounds its answer in them.
- **Two-stage pipeline** — an answer model proposes the correct choices, then a decision model independently
  verifies and assigns a 0–1 confidence score to each choice.
- **Settings** — your OpenRouter API key plus model names for both stages (defaults to `openai/gpt-4o-mini`).
  API key is stored locally in the renderer's localStorage only.

## Requirements

- Node.js 18+
- Linux: X11 works out of the box. On **Wayland**, screen/window capture also requires Electron's PipeWire
  support (`--enable-features=WebRTCPipeWireCapturer`); prefer running under XWayland if capture fails.
- Free / no system OCR dependency: tesseract.js runs as WASM.

## Run

### Portable AppImage (recommended)

Build a portable, no-install `.AppImage`:

```bash
npm install
npm run dist
```

The binary lands in `dist/QuizSolver-0.2.0-x86_64.AppImage`. Make it executable and run it —
no installation needed, language data for OCR (Romanian, Hungarian, English) is bundled inside the image, so OCR works offline:

```bash
chmod +x QuizSolver-0.1.0-x86_64.AppImage
./QuizSolver-0.1.0-x86_64.AppImage
```

(The OpenRouter API call of course still needs internet, and your API key.)

### From source

```bash
npm start
```

1. Click **Settings** and enter your [OpenRouter](https://openrouter.ai/) API key.
2. Capture the question with any capture method. Use **Adjust crop** to trim to the question area.
3. (Optional) attach reference documents.
4. Click **Solve**.

## How the pipeline works (`lib/pipeline.js`)

```
capture → runOcr() → answerQuestion() → scoreAnswers() → answers + confidence
```

- `lib/ocr.js` — tesseract.js OCR on the captured PNG.
- `lib/openrouter.js` — two chat-completion calls in JSON mode:
  - **Answer model** — given OCR text (+ document context), returns `answers[{choice, correct, explanation}]` covering every choice.
  - **Decision model** — independently judges each choice and returns `answers[{choice, correct, confidence, explanation}]`.
- Output table shows each choice, correct/incorrect, confidence %, and explanation.

## Notes

- Only use on material you are allowed to use it on; check your institution's policies.
  This tool is intended for studying and self-testing.
