# Scanning a controlekaart with the camera

How the "Scan card with camera" button on the answer-sheet form works, why it is
built the way it is, and what to change if you want a different engine.

The scanner fills **ORC letters (rows 1–30) and the IPT / WPT / +/- times
only**. Strafpunten and Merk are officials' judgement and are never guessed from
a photo. The operator still picks the stage and the EQ by hand; what the card's
header says is shown next to that choice as a cross-check, never applied.

---

## 1. Which OCR approach, and why

Two architectures were on the table.

| | **A — browser (shipped)** | **B — server microservice** |
| --- | --- | --- |
| Alignment | hand-rolled homography + corner drag | OpenCV `findContours` / `warpPerspective` |
| Recognition | Tesseract.js (wasm), self-hosted | PaddleOCR / EasyOCR / Tesseract in Python |
| Deployment | none — same container | second container or sidecar, ~1–2 GB image |
| Photo leaves the device | no | yes |
| Cold start | ~7 MB of wasm + 3 MB model, then cached | none for the client |
| Per card | ~2–5 s on a mid-range phone | ~1–2 s plus upload |
| Offline at a rally | works | needs the network up |

**Option A shipped.** The deciding argument is not raw engine accuracy — it is
that *the engines are not what makes this work*.

The hard part of a controlekaart is not reading a letter, it is knowing which
box the letter is in. Once each cell is isolated, deskewed, stripped of its
printed rules and normalised to a single centred glyph on white, the recogniser
is being asked a much easier question than "read this page". That segmentation
work is identical in both options and is where nearly all of the accuracy comes
from. Given that, Option B would buy a modest recognition improvement in
exchange for a second service to deploy, monitor and keep in sync with a
single-container app that currently has none — and it would put photographs of
competitors' cards on the wire.

### Be realistic about the numbers

Tesseract's LSTM model is trained on **printed** text. On isolated handwritten
capitals it is usable but not good; expect a meaningful minority of cells to
need correcting, more when the pen is thin or the writing is slanted. Digits in
the time columns fare better because they are written as a group and the
whitelist is only ten characters wide.

That expectation is baked into the UI rather than hidden: every value lands in
an editable box, colour-coded by confidence, and nothing reaches the real form
until **Apply** is pressed. The feature is a first draft that removes most of
the typing, not an autopilot. Treat any claim of a specific accuracy percentage
in this document as an expectation, not a measurement — no benchmark against a
corpus of real SARK cards has been run.

PaddleOCR and EasyOCR would not change this materially; they are also
print-oriented. **The real accuracy upgrade is a small classifier trained on
handwritten characters** (EMNIST-letters class, a ~1–2 MB CNN run through ONNX
Runtime Web), which handles isolated handwritten capitals far better than any
general OCR engine and stays entirely in the browser. See §6 — the code is
already shaped for that swap.

---

## 2. The pipeline

`app/lib/ocr/`, all of it browser-side. These modules must never import
`server-only` or `node:` builtins.

```
photo ──► detectCardQuad ──► warpPerspective ──► buildInkMask ──► buildGrid ──► per-cell OCR
         (geometry.ts)      (geometry.ts)      (preprocess.ts)   (layout.ts)   (recognizer.ts)
                    └── operator can drag the four corners ──┘
```

### 2.1 Alignment — `geometry.ts`

Finding the card:

1. Downscale to 400 px wide (box average) and take Otsu's threshold.
2. **Close** the bright mask with a radius-2 kernel. This matters: downscaling a
   2 px printed rule leaves a mid-grey line that Otsu still calls dark, which
   chops the card's interior into sixty-odd disconnected table cells. Without
   the closing, a flood fill started in the middle finds one cell, not the card.
3. Flood fill from the centre of the frame — the capture overlay asks the
   operator to put the card there.
4. Reject anything covering less than a fifth of the frame.
5. Convex hull of the region's per-row extremes, then drop vertices one at a
   time — cheapest by area lost — until four remain. This is the cheap stand-in
   for `approxPolyDP`.

Flattening: solve the 3×3 homography from the *destination rectangle to the
source quad* (8×8 Gaussian elimination with partial pivoting) so every output
pixel is one bilinear lookup, then warp to 1600 px wide at the aspect ratio the
quad implies, clamped to 1.15–1.8.

**The corner handles are part of the design, not a fallback.** A hand holding
the card, a busy table, a shadow across one edge — each defeats the detector,
and dragging four handles takes two seconds. The detector's job is to be right
often enough that they rarely move.

No OpenCV.js. It would supply exactly these three primitives at the cost of a
~9 MB WebAssembly download that would itself have to be self-hosted to satisfy
the CSP. The three primitives are about 200 lines.

### 2.2 Ink and stamps — `preprocess.ts`

Three kinds of mark share every cell: the printed grid (thin, near-black), the
competitor's pen (blue or black, thick), and the officials' orange/red stamps.

Stamps are removed **first, on hue**, because they are as dark as pen ink in
luminance — a luminance threshold cannot tell them apart. Each pixel goes to
HSV; hue ≥ 335° or ≤ 30° with saturation ≥ 0.32 and value ≥ 0.22 is stamp ink.
Those pixels are painted white *before* thresholding, so a stamp cannot drag the
local mean down and pull surrounding paper into the ink mask either.

What is left is binarised with a Bradley adaptive threshold — the mean of a
window 1/16 of the image wide, biased 15 % — computed from an integral image.
Adaptive, not global: the corner of a photographed card is routinely two stops
darker than its centre.

A cell whose stamp coverage exceeds 4 % is reported as **stamped** and returned
blank, with the box tinted orange in the review grid. A cell below 1.2 % ink is
empty and never reaches OCR at all; on a typical card that is 120 of 150 cells,
which is the difference between a three-second scan and a twenty-second one.

Cells that do hold ink are normalised: inset 14 % to drop the printed rules,
cropped to the ink bounding box, scaled to a fixed glyph height and centred on a
white square with a wide quiet zone. This is what makes a print-trained engine
usable on handwriting — Tesseract's layout analysis is left with nothing to get
wrong.

### 2.3 Grid geometry — `layout.ts`

Cell rectangles are found **structurally**, from the printed rules. Fixed
proportions are only the fallback, because a 1 % vertical error accumulates into
a whole row by ORC 30.

Two features carry it:

* **Longest ink run.** A printed rule is a nearly unbroken line spanning its
  whole table or block; a filled header bar or a heavy pen stroke is not. Run
  length separates them where a dark-pixel *count* does not — the solid TOTAAL
  STRAFPUNTEN bar is the case that breaks counting.
* **Even spacing.** The 15 ORC rows and the 10 time rows are equally tall, so
  their separators form an arithmetic progression. Taking the longest evenly
  spaced run of detected lines discards header rules, the TOTAAL rule and stray
  lines without needing to know how many header rows a card printing has.

Two details are load-bearing, both found by testing against synthetic cards:

* **Shear tolerance.** Corner estimation is never exact, so a rule that was
  horizontal on paper is still sheared by a fraction of a degree after warping.
  Half a degree over a 1400 px rule is a 12 px drift — enough to shatter it into
  ~300 px fragments and hide the table's own border *below* every row separator.
  The mask is therefore dilated perpendicular to the rules being sought (0.7 % of
  the short side) before runs are measured. A symmetric dilation does not move a
  group's centre, so cell positions stay unbiased.
* **Band anchoring.** The three scanned blocks share one vertical band — 15 ORC
  rows, 15 more, and 10 time rows all span the same height. The time block's
  header happens to be almost exactly one time-row tall, so its evenly spaced run
  extends one line upwards and *every* value lands a row too high. The ORC block
  resolves the band first (its pitch is finest, so it is least ambiguous) and the
  time block is aligned to what it found.

Column lines are found across the full table: 19 full-height rules are expected,
of which the first 18 bound the three scanned blocks. The MERK block's internal
rules stop at the TOTAAL STRAFPUNTEN box, so it contributes an unpredictable
number of extras on the right — hence the tolerance on the count and the use of
only the first 18.

Fallback is progressive: no table box means nominal proportions throughout, no
column set means nominal columns with detected rows, and so on. `gridDetected`
comes back false whenever any part fell back, and the review screen says so.

### 2.4 Recognition — `recognizer.ts`

Whitelists are the single biggest accuracy lever available on a fixed grid:

| Field | PSM | Whitelist |
| --- | --- | --- |
| ORC letters | 10 (single character) | `A–Z` |
| IPT / WPT / +/- | 7 (single line) | `0-9 : . + -` |
| Controlekaart no. | 7 | `IVX0-9` |
| EQ no. | 7 | `0-9` |

PSM 10 matters: the cell is already segmented, so any layout analysis Tesseract
does can only hurt.

Two workers, not one. Changing `tessedit_char_whitelist` forces Tesseract to
rebuild its character set, and the pipeline alternates between letters and
digits constantly; one worker per character class means each whitelist is set
once. The mode cache is keyed on whitelist+PSM so kinds that share a character
set (times and +/-) never force a reconfigure.

Times are normalised after the read, because officials write `9.40`, `940` and
`09:40` interchangeably: strip the separator, re-pad to four digits, re-insert
the colon. An out-of-range value such as `19:70` is still returned — the
operator is better placed to fix it than we are — but its confidence is docked
so it shows up red.

---

## 3. The extraction payload

`toScanPayload()` in `types.ts` produces the agreed shape; the review screen
shows it under "Extraction payload (JSON)". Only non-empty entries appear.

```json
{
  "controlekaartNo": "I",
  "eqNo": "46",
  "orcLetters": {
    "1": ["K"], "2": ["Z"], "3": ["D"], "9": ["U", "A"],
    "19": ["R", "U"], "22": ["S", "S", "S", "S"],
    "28": ["N", "D"], "30": ["A", "A"]
  },
  "officialUse": {
    "2": { "wpt": "09:40" },
    "3": { "wpt": "10:56" }
  }
}
```

Internally each cell also carries `confidence` (0–1), `stamped` and `empty`,
which is what drives the colour coding. Below 0.55 the box is red, below 0.75
amber, otherwise green; stamped cells are orange and blank.

---

## 4. Assets, CSP and permissions

The Tesseract runtime is **self-hosted** under `public/ocr/`, staged out of
`node_modules` by `scripts/setup-ocr-assets.mjs` — the worker, both LSTM wasm
cores (SIMD and plain; the worker feature-detects), and `eng.traineddata.gz`
from the `@tesseract.js-data/eng` package. It runs automatically before
`npm run dev` and `npm run build`, or on demand:

```bash
npm run setup:ocr
```

Nothing is committed and nothing is downloaded beyond the `npm ci` that has to
happen anyway, so Docker builds need no extra network access. If the files are
missing the app still builds; the scanner reports `OcrAssetsMissingError` and
tells you to run the script.

Self-hosting is what keeps `connect-src` and `script-src` at `'self'`. Three
header changes in `next.config.ts` were needed and no more:

* `script-src` gains **`'wasm-unsafe-eval'`** — WebAssembly compilation only,
  not `eval()` or `new Function()`.
* **`worker-src 'self'`** (plus `child-src` for older browsers). Tesseract.js is
  configured with `workerBlobURL: false` so it loads the worker straight from
  its own URL; no `blob:` source is needed.
* `Permissions-Policy` moves from `camera=()` to **`camera=(self)`**. Everything
  else stays denied and cross-origin frames still get nothing.

`/ocr/*` sits behind the middleware's session check like every other path. Same-
origin worker and `fetch` requests carry the session cookie, so this works
without an exception — the OCR assets are not public.

The first scan of a session downloads roughly 10 MB (wasm core plus language
model); the browser caches the wasm and Tesseract caches the model in IndexedDB,
so later scans start immediately. On a phone on rally-site mobile data, do the
first scan before you need it.

---

## 5. Option B — server-side extraction

Worth revisiting if the recogniser needs to be something that will not run in a
browser, or if scanning moves to a device too weak to warp a 2 MP image.

Note first that `POST` bodies are capped at 256 KB by `app/lib/body.ts`, and a
JPEG of a card is several times that. A server route would need to accept
`multipart/form-data` with its own bounded reader rather than going through
`readBody()` — do not simply raise the cap, it guards every other endpoint.

Sketch of the service:

```python
# ocr-service/main.py
from fastapi import FastAPI, UploadFile
import cv2, numpy as np
from paddleocr import PaddleOCR

app = FastAPI()
engine = PaddleOCR(lang="en", use_angle_cls=False, show_log=False)

@app.post("/extract")
async def extract(file: UploadFile):
    buffer = np.frombuffer(await file.read(), np.uint8)
    image = cv2.imdecode(buffer, cv2.IMREAD_COLOR)

    # 1. corners: same idea as geometry.ts, with library support
    grey = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    edges = cv2.Canny(cv2.GaussianBlur(grey, (5, 5), 0), 60, 180)
    contours, _ = cv2.findContours(edges, cv2.RETR_LIST, cv2.CHAIN_APPROX_SIMPLE)
    card = max(contours, key=cv2.contourArea)
    quad = cv2.approxPolyDP(card, 0.02 * cv2.arcLength(card, True), True)

    # 2. flatten
    matrix = cv2.getPerspectiveTransform(order_quad(quad), DEST_RECT)
    flat = cv2.warpPerspective(image, matrix, (1600, 1100))

    # 3. drop stamps in HSV, exactly as preprocess.ts does
    hsv = cv2.cvtColor(flat, cv2.COLOR_BGR2HSV)
    stamp = cv2.inRange(hsv, (0, 80, 60), (15, 255, 255)) | \
            cv2.inRange(hsv, (167, 80, 60), (180, 255, 255))
    flat[stamp > 0] = (255, 255, 255)

    # 4. same grid model, then one crop per cell
    return {"orcLetters": read_letters(flat), "officialUse": read_times(flat)}
```

The client side barely changes. Implement the `Recognizer` interface against the
service and hand it to `scanScorecard` — everything upstream of recognition
stays local, so only the ~30 normalised cell bitmaps travel, not the photograph:

```ts
class RemoteRecognizer implements Recognizer {
  async init() {}
  async read(image: HTMLCanvasElement, kind: RecognizeKind) {
    const blob = await new Promise<Blob>((r) => image.toBlob((b) => r(b!), 'image/png'));
    const body = new FormData();
    body.append('cell', blob);
    body.append('kind', kind);
    const response = await fetch('/api/ocr/cell', { method: 'POST', body });
    return response.json();
  }
  async destroy() {}
}
```

That variant is worth more than a full server pipeline: it keeps the alignment
and segmentation work — which is what actually makes this accurate — on the
client, and asks the server only for the part a browser is weak at. It also
keeps `connect-src 'self'` intact, since the route is same-origin.

---

## 6. Making it more accurate

In rough order of value per unit of work:

1. **Swap the recogniser for a handwriting model.** Implement `Recognizer`
   around an EMNIST-letters CNN (~1–2 MB) via ONNX Runtime Web. Cells arrive
   pre-segmented, centred and binarised — exactly the input such a model is
   trained on. This is the change that moves the accuracy number.
2. **Use the stage's answer key as a prior.** Every ORC row has a known set of
   plausible letters. Re-ranking a low-confidence read against that set would fix
   a large share of confusions (`U`/`V`, `S`/`5`, `O`/`Q`) at no runtime cost.
   Deliberately *not* done yet: it biases the read towards the key, and grading a
   sheet against a key that helped produce it needs thought before it is shipped.
3. **Two frames instead of one.** Scan twice and keep the higher-confidence read
   per cell.
4. **Refine corners at full resolution.** Detection currently runs at 400 px;
   a local search around each corner on the full image would cut the residual
   shear that §2.3 works around.

---

## 7. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| "OCR runtime not found under /ocr" | assets not staged | `npm run setup:ocr` |
| Camera never starts | page not on HTTPS/localhost, or permission denied | browse over `localhost` or TLS; use "Choose a photo" |
| Review says the grid is an estimate | rules not readable — glare, blur, heavy crop | retake with even light, keep the whole border inside the guide |
| Boxes in the overlay are offset by a row | corners were wrong | drag the handles onto the card's printed corners and scan again |
| Everything reads blank | photo too dark, or the card fills too little of the frame | fill the guide; avoid backlight |
| Whole rows read as blank with orange boxes | stamps — working as intended | type those rows by hand |

Tuning knobs, all named constants: `STAMP_HUE_LOW` / `STAMP_HUE_HIGH` /
`STAMP_MIN_SATURATION` (stamp colour band), `ADAPTIVE_BIAS` (binarisation),
`DILATION_FRACTION` (shear tolerance), `STAMP_THRESHOLD` (when a cell counts as
stamped), and `CONFIDENCE_LOW` / `CONFIDENCE_MEDIUM` in `ScorecardScanner.tsx`.

## 8. Verifying a change

There is no test framework in this repo and this feature did not add one. The
geometry, ink-mask and grid modules are pure functions over `ImageData`, so they
can be exercised from Node with a small `ImageData` shim and a synthetic card —
draw a grid at known coordinates, push it through a known homography, and assert
that the detected cell centres land within a fraction of a cell of the truth.
That is how the shear tolerance, the band anchoring and the flood-fill closing
above were each found; all three were silent failures that a browser test would
have shown only as "the letters are one row off".
