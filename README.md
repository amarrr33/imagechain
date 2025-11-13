

# ImageChain: Secure Image Version Control

A cryptographic image version control system that embeds complete version history invisibly into image files using steganography. No external databases or servers required - everything is stored in the image itself.

## What Makes This Novel?

Unlike traditional version control (Git, SVN) or cloud-based DAM systems, ImageChain is the **first self-contained, cryptographically signed, steganographic image version control system**. The entire version history is embedded invisibly in the image file itself using steganography, making it:

- **Self-contained**: History travels with the image (no external files needed)
- **Cryptographically secure**: Each version is signed and linked via hash chains
- **Zero-infrastructure**: Works entirely offline, no servers or subscriptions
- **Tamper-proof**: Any modification breaks cryptographic signatures
- **Portable**: Share the image, get the complete history automatically

See [NOVELTY.md](NOVELTY.md) for a detailed comparison with existing solutions.

## Features

- 🔐 **Cryptographic Signing**: Each version is signed with RSA or ECC keys
- 🔗 **Hash Chain Verification**: Tamper-proof version linking
- 💧 **Steganographic Watermarking**: Invisible data embedding in image pixels
- 🛡️ **Tamper Detection**: Detects modifications even when embedded data is lost (JPEG re-encoding, heavy edits)
- 🔄 **Error Recovery**: Automatic recovery from minor pixel value changes (brightness, contrast)
- 📡 **DCT Embedding**: Frequency-domain embedding for critical metadata (survives JPEG compression)
- 📦 **Self-Contained**: Complete history stored in the image file
- 🖼️ **Image Editing**: Built-in editor with brightness, contrast, filters, rotation, and text overlay
- ✅ **Offline-First**: Runs entirely in your browser, no internet required

## How It Works

### Core Concept

ImageChain embeds the entire version history directly into image files using steganography (invisible watermarking). This means:

1. **No External Storage Needed**: The image file itself contains all version information
2. **Self-Verifying**: Anyone with the image can extract and verify the version history
3. **Tamper-Proof**: Cryptographic signatures and hash chains detect any modifications

### Why Public Keys?

You can **extract** the version history from any ImageChain file without a public key. However, to **verify** that signatures are authentic and the chain hasn't been tampered with, you need the public key that corresponds to the private key used to sign the versions.

- **Extraction** (no key needed): Read the embedded history from the image
- **Verification** (key needed): Confirm signatures are valid and chain is unbroken

### Editing Committed Images

If you edit a committed ImageChain file outside the app (e.g., in Photoshop) and upload it:

1. The app detects and extracts the existing version history
2. It allows you to continue the version chain from that point
3. The new edit creates a new version entry with a new hash
4. Note: If you use different keys, old signatures won't verify with the new public key, but the history is still preserved

## Installation & Setup

### Prerequisites

- **Node.js** (v18 or higher recommended)
- **npm** or **yarn**

### Local Installation

1. **Clone or download this repository**

2. **Install dependencies:**

   ```bash
   npm install
   ```

3. **Start the development server:**

   ```bash
   npm run dev
   ```

4. **Open your browser:**
   - Navigate to `http://localhost:3000`
   - The app runs entirely offline - no API keys or external services needed

### Building for Production

```bash
npm run build
```

The built files will be in the `dist/` directory. You can serve them with any static file server:

```bash
npm run preview
```

## Usage Guide

### Creating a New Image Chain

1. **Setup Signer & Keys**

   - Enter a signer name (your identity)
   - Choose signature scheme: RSA-3072 or ECC P-256
   - Click "Continue to Upload"

2. **Upload an Image**

   - Upload a PNG or JPEG image
   - The app generates keys and creates the initial version

3. **Edit & Commit**

   - Use the editing tools (brightness, contrast, filters, rotation, text)
   - Click "Commit Version" to save changes
   - Each commit creates a new version with cryptographic signature

4. **Download**
   - Download the image with embedded version history
   - The file contains the complete chain invisibly embedded

### Verifying Version History

1. **From Active Session**

   - Go to "Version History" tab
   - Click "Verify Session Image" if you have an active session

2. **From File**
   - Upload an ImageChain file
   - Paste the public key used to sign the versions
   - Click "Verify Image File"
   - View detailed verification results for each version

### Automated Demo

1. Go to the "Automated Demo" tab
2. Click "Run Automated Demo"
3. Watch as it:
   - Generates cryptographic keys
   - Creates 3 versions with different edits
   - Embeds the complete history
   - Verifies the entire chain

The demo shows detailed step-by-step logs explaining each operation.

## Technical Details

For complete technical documentation, see:

- **[TECHNICAL_DETAILS.md](TECHNICAL_DETAILS.md)** - Complete technical explanation of all mechanisms
- **[RECOVERY_LAYER.md](RECOVERY_LAYER.md)** - Error correction and recovery system
- **[TAMPER_DETECTION.md](TAMPER_DETECTION.md)** - How tampering is detected even when data is lost
- **[DCT_EMBEDDING.md](DCT_EMBEDDING.md)** - Frequency-domain embedding for JPEG robustness

### Quick Technical Overview

**Signature Schemes:**

- **RSA-PSS**: RSA with Probabilistic Signature Scheme (3072-bit keys)
- **ECC P-256**: Elliptic Curve Digital Signature Algorithm (P-256 curve)

**Steganography:**

- **Hybrid approach**: DCT (frequency-domain) for critical metadata + LSB (spatial-domain) for full history
- **DCT embedding**: Critical metadata survives JPEG compression
- **LSB embedding**: Full version history in pixel LSBs
- Data is compressed with DEFLATE (pako) before embedding
- Maximum payload size: ~75% of image pixels (excluding alpha channel)
- **Zero visible quality loss** - changes are imperceptible to human eye

**Version Structure:**

Each version entry contains:

- Version number
- SHA-256 hash of the image
- Parent hash (links to previous version)
- Timestamp
- Signer identity
- Edit log (operations applied)
- Snapshot (compressed preview for destructive edits)
- Cryptographic signature

**How It Works:**

1. Version history is converted to JSON
2. Critical metadata extracted (chain_id, version_count, last_hash)
3. Critical metadata embedded in DCT domain (survives JPEG)
4. Full history compressed using DEFLATE (reduces size by 70-90%)
5. Error correction codes added (triple redundancy for recovery)
6. Checksum calculated for tamper detection
7. Converted to binary string
8. Full history embedded in image pixels using LSB steganography
9. Extraction tries DCT first, then LSB, and attempts recovery if needed

**Tamper Detection (Even When Data is Lost):**

- If LSB data is lost (JPEG re-encoding, heavy edits), extraction fails
- **But**: Hash chain verification still works if you have the public key
- The system computes the current image hash and compares it to the last version's hash
- **Mismatch = tampering detected**, even without embedded data
- See [TAMPER_DETECTION.md](TAMPER_DETECTION.md) for complete details

## Project Structure

```
├── components/
│   ├── Demo.tsx              # Automated demo component
│   ├── ImageWorkflow.tsx     # Main editing workflow
│   ├── VersionHistory.tsx    # Version verification UI
│   └── Icons.tsx             # Icon components
├── services/
│   ├── cryptoService.ts      # Cryptographic operations
│   ├── imageService.ts       # Image processing utilities
│   └── watermarkService.ts    # Steganography functions
├── types.ts                  # TypeScript type definitions
├── App.tsx                   # Main application component
└── index.tsx                 # Application entry point
```

## Browser Compatibility

- Chrome/Edge (recommended)
- Firefox
- Safari
- Any modern browser with Web Crypto API support

## Security Notes

- All cryptographic operations use the Web Crypto API
- Private keys never leave your browser
- No data is sent to external servers
- The app runs entirely client-side

## Troubleshooting

### "Payload is too large to embed"

- Use smaller images or reduce the number of versions
- Snapshots are automatically compressed, but many versions increase payload size
- Try using smaller images (e.g., 512x512 or smaller)

### "Could not extract payload" or "Data corruption detected"

- **If extraction fails but you have the public key**: The system can still detect tampering via hash chain verification
- The image may have been heavily compressed (JPEG re-encoding) or edited outside the app
- **Brightness/contrast adjustments**: Usually recoverable with error correction
- **JPEG re-encoding**: LSB data is lost, but hash verification will still detect tampering
- Try uploading the original ImageChain file (PNG format recommended)

### Verification fails

- Ensure you're using the correct public key
- The key must match the private key used to sign the versions
- Check that the image hasn't been modified outside the app

## License

This project is provided as-is for educational and demonstration purposes.

## Contributing

Contributions, issues, and feature requests are welcome!
