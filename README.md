# Molecules ToGo

Client‑only web app to view, share, and open 3D molecular structures in AR.

## What it does

- Parse and visualize molecules from SDF/MOL or XYZ files entirely in the browser
- Share a molecule via a single URL or QR code using a compact payload
- Optional simple encryption for the shared payload (password required on open)
- Export GLB/USDZ locally and open in AR (using a locally registered `@google/model-viewer`)
 - Export GLB/USDZ locally and open in AR
- No molecular data is uploaded to a server; processing stays in your browser

 

## UI guide

- Viewer
	- Drag & drop an SDF/MOL or XYZ file
	- Rotate/zoom, fit camera, and optionally enable a rotate mode overlay for direct rotation
	- Large structures automatically switch to lower quality; you can change this in Options

- AR panel
	- Exports GLB and USDZ locally in the browser
	- Open AR: iOS uses Quick Look (USDZ); other platforms use WebXR via model‑viewer
	- On AR‑unsupported devices, a message is shown

- QR Sharing panel
	- Generates a compact share URL and QR code on the client only
	- Options include:
		- Title (up to 63 chars)
		- Dot shape (Square/Round/Diamond/Rounded square)
		- Center icon (None/Brand/Upload)
		- Error correction (L/M/Q/H)
		- Coordinate step (approx.) via precision drop (0–8)
		- Bond data (Include / Auto‑generate)
		- Atom indices (As‑is / Optimized delta)
		- Simple encryption (password ≥ 4 chars)
	- Copy URL / Download SVG / Download PNG

## Share format (overview)

- The share URL is of the form `/qr#<payload>`
- Payload is a compact binary encoding of:
	- Molecule (atoms, bonds; bonds can be omitted and auto‑generated)
	- Style (material, atom radius scale, bond radius, quality)
	- Optional title
- Encoding stack:
	- Pako deflate → Base80 text encoding
 

Notes on size and capacity:
- QR codes have strict capacity. If your payload overflows, try:
	- Increase Coordinate step (precision drop)
	- Enable Optimized atom indices (delta)
	- Auto‑generate bonds
	- Lower error correction (e.g., H → Q → M → L)

## Privacy and security notes

These points are important. Please read carefully.

- Client‑only processing
	- Molecule parsing, encoding/decoding, encryption/decryption, AR export, and QR generation all happen locally in your browser. There is no upload of molecular coordinates or files to a server.
 

- Share URL and QR contents
	- The URL fragment (`#<payload>`) contains the compact payload. The hash is not sent to servers on HTTP requests, but:
		- The link you share will include the fragment, and anyone who obtains the link (or scans the printed QR) receives the payload.
		- If you publish or print the QR, it contains your payload in full (or encrypted form if you enable encryption).

- Simple encryption (optional)
	- The app uses PBKDF2 (WebCrypto) to derive a key from your password, then AES‑GCM to encrypt the payload in the browser.
	- This is a “simple” scheme meant for convenience, not a substitute for a rigorously audited secure channel.
	- Secure context (HTTPS) is required for WebCrypto’s SubtleCrypto API. Without HTTPS, encryption/decryption will be unavailable.

- Downloaded models can be duplicated
	- GLB/USDZ exports contain mesh data derived from your structure. Once downloaded, these files can be freely copied by anyone who has them.
	- If you need to control downstream distribution, encrypt and share only with trusted recipients, and consider additional protective measures outside this tool.

## Self‑hosting and QR longevity (optional)

- This app is client‑only and requires no backend. You can self‑host it to control the domain and keep links stable. Deployment is optional; any static hosting or running a Node process with the built output works.
- Important: QR codes embed the full URL, including your domain (e.g., https://example.com/qr#<payload>). If that domain stops working or the route changes, old QR codes will break.
- Recommended practices to keep existing QR codes working:
	- Use a stable custom domain you control long‑term, and keep the `/qr` route unchanged.
	- If you must migrate domains, keep the old domain alive long enough to serve a small client‑side redirect page that preserves the URL fragment (hash). For example, serve an index.html with:
    
	- Avoid server‑side URL shorteners for share links; most cannot preserve the fragment.
	- For printed materials, consider adding a brief fallback note such as: “If the QR fails, open your trusted instance of this app and append the payload after `/qr#`,” or include the payload text alongside the QR.

## Known limits & tips

- QR capacity constraints: complex molecules may exceed capacity. Use the QR options (precision drop, delta indices, omit bonds, lower ECC) to reduce size.
- Very large structures: the viewer falls back to lower quality automatically. You can tweak quality in the Options panel.
 

## Development

Project stack:

- Next.js 15 / React 19 / TypeScript
- three.js with @react-three/fiber and drei
- `@google/model-viewer` (locally imported)
- Compression: `pako`
- QR: `qrcode`

 

## Folder structure (high‑level)

- `app/` — Next.js app routes and pages (`/`, `/qr`)
- `components/` — UI components (Viewer, AR panel, QR panel, etc.)
- `lib/` — Core logic: chemistry types, parsing, export, sharing (encode/decode), utilities
- `public/` — Static assets (favicon, etc.)
- `styles/` — Global CSS

## License

Apache-2.0. See `LICENSE` if present, or the `license` field in `package.json`.

## Acknowledgements

- three.js, @react-three/fiber, drei
- @google/model-viewer
- pako
- qrcode

## Disclaimer

This tool aims to keep all molecular processing in the browser and provide convenient sharing. However, payloads included in links or QR codes can be propagated by anyone who obtains them, and once decrypted, coordinates are recoverable. Exported GLB/USDZ can be freely duplicated. Use at your own discretion and adopt additional safeguards as needed for sensitive data.

