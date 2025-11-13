# ImageChain: Complete Technical Explanation

## Table of Contents

1. [Overview](#overview)
2. [How Version History is Embedded (Steganography)](#how-version-history-is-embedded-steganography)
3. [Why Image Quality Isn't Affected](#why-image-quality-isnt-affected)
4. [DCT Frequency-Domain Embedding](#dct-frequency-domain-embedding)
5. [Recovery and Tamper Detection Layer](#recovery-and-tamper-detection-layer)
6. [Complete Workflow: Commit to Extraction](#complete-workflow-commit-to-extraction)
7. [Cryptographic Mechanisms](#cryptographic-mechanisms)
8. [Hash Chain Architecture](#hash-chain-architecture)
9. [Data Flow Diagrams](#data-flow-diagrams)
10. [Extraction and Root Tracing](#extraction-and-root-tracing)
11. [Tamper Detection When Data is Lost](#tamper-detection-when-data-is-lost)

---

## Overview

ImageChain embeds complete version history **invisibly** into image files using:

- **LSB Steganography**: Hides data in least significant bits of pixels
- **DCT Frequency-Domain Embedding**: Critical metadata in frequency domain (survives JPEG)
- **Data Compression**: Reduces payload size using DEFLATE (70-90% reduction)
- **Error Correction Codes**: Triple redundancy for recovery from pixel value changes
- **Checksum Verification**: Detects corruption and tampering
- **Cryptographic Signing**: Each version is cryptographically signed
- **Hash Chains**: Versions linked via cryptographic hashes

**Key Innovation**: Hybrid embedding approach - DCT for critical metadata (survives JPEG) + LSB for full history. Even when LSB data is lost, critical metadata can be recovered from DCT domain, and tampering can still be detected via hash chain verification.

The result: A single image file contains its complete version history, cryptographically signed, tamper-proof, recoverable from minor edits, and robust against JPEG compression.

---

## How Version History is Embedded (Steganography)

### What is LSB Steganography?

**LSB (Least Significant Bit) Steganography** hides data by modifying the least significant bit of each color channel in image pixels. The human eye cannot detect these tiny changes.

### Image Pixel Structure

Each pixel in an image consists of 4 bytes (RGBA):

```
Pixel = [R, G, B, A]
       [0-255, 0-255, 0-255, 0-255]
```

Example pixel: `[150, 200, 100, 255]`

- R (Red) = 150 = `10010110` in binary
- G (Green) = 200 = `11001000` in binary
- B (Blue) = 100 = `01100100` in binary
- A (Alpha/transparency) = 255 = `11111111` in binary

### The LSB Trick

The **least significant bit** (rightmost bit) has minimal visual impact:

- Changing `150` (1001011**0**) to `151` (1001011**1**) = 0.4% change
- Human eye cannot detect this difference
- But we can store 1 bit of data per color channel!

### Step-by-Step Embedding Process

#### Step 1: Prepare the Payload

```javascript
// 1. Create version history structure
const payload: ChainedPayload = {
  chain_id: "abc123...",  // Hash of original image
  history: [
    { version: 1, sha256: "...", parent_hash: null, ... },
    { version: 2, sha256: "...", parent_hash: "...", ... },
    // ... more versions
  ]
};

// 2. Convert to JSON string
const jsonString = JSON.stringify(payload);
// Result: '{"chain_id":"abc123...","history":[...]}'

// 3. Compress using DEFLATE (reduces size by ~70-90%)
const compressed = pako.deflate(jsonString);
// Result: Uint8Array of compressed bytes

// 4. Convert compressed bytes to string
const compressedString = String.fromCharCode.apply(null, compressed);
```

**Why compress?**

- Reduces payload size dramatically
- More versions can fit in the image
- Faster embedding/extraction

#### Step 2: Convert to Binary

```javascript
// Convert each character to 8-bit binary
const stringToBinary = (str: string): string => {
  return str
    .split("")
    .map((char) => {
      return char.charCodeAt(0).toString(2).padStart(8, "0");
    })
    .join("");
};

// Example: "A" (ASCII 65) → "01000001"
const binaryPayload = stringToBinary(compressedString) + END_OF_MESSAGE;
// END_OF_MESSAGE = "010001010100111001000100" ("END" in binary)
```

**Why add END marker?**

- Tells extraction where the data ends
- Prevents reading garbage data after payload

#### Step 3: Embed in Image Pixels

```javascript
// Get image pixel data
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const data = imageData.data; // Uint8Array: [R, G, B, A, R, G, B, A, ...]

let payloadIndex = 0;
for (let i = 0; i < data.length && payloadIndex < binaryPayload.length; i++) {
  // Skip alpha channel (every 4th byte)
  if ((i + 1) % 4 === 0) continue;

  let pixelValue = data[i]; // Current pixel value (0-255)
  const bit = binaryPayload[payloadIndex]; // '0' or '1'

  if (bit === "1") {
    pixelValue |= 1; // Set LSB to 1 (make odd)
    // Example: 150 (even) → 151 (odd)
  } else {
    pixelValue &= ~1; // Set LSB to 0 (make even)
    // Example: 151 (odd) → 150 (even)
  }

  data[i] = pixelValue; // Update pixel
  payloadIndex++;
}

// Write modified pixels back to canvas
ctx.putImageData(imageData, 0, 0);
```

**Visual Example:**

```
Original Pixel:  [150, 200, 100, 255]
Binary:          [10010110, 11001000, 01100100, 11111111]
Data to embed:   "101" (3 bits)

After embedding:
Pixel:           [151, 200, 101, 255]  ← Only LSBs changed
Binary:          [10010111, 11001000, 01100101, 11111111]
                 ↑        ↑           ↑
                 Changed  Unchanged   Changed

Visual difference: IMPERCEPTIBLE to human eye!
```

### Capacity Calculation

For a 128x128 image:

- Total pixels: 128 × 128 = 16,384 pixels
- Bytes per pixel: 4 (RGBA)
- Total bytes: 16,384 × 4 = 65,536 bytes
- Usable bytes (excluding alpha): 65,536 × 3/4 = 49,152 bytes
- Bits available: 49,152 bits = 6,144 bytes
- After compression: Can store ~15-20 versions easily

---

## Why Image Quality Isn't Affected

### Mathematical Proof

**LSB changes affect pixel values by at most ±1:**

```
Original value: 150
After LSB change: 150 or 151
Difference: 0 or 1
Percentage change: 0% or 0.67%
```

**Human visual perception:**

- Human eye can detect ~1-2% changes in brightness
- LSB changes are 0-0.67% (below detection threshold)
- Changes are distributed across all pixels (not concentrated)
- No visible patterns or artifacts

### Why It Works

1. **Statistical Distribution**

   - Changes are random across the image
   - No clustering or patterns
   - Looks like natural image noise

2. **Minimal Impact**

   - Each pixel changes by 0 or 1 (out of 255)
   - 0.4% maximum change per channel
   - Well below human detection threshold

3. **Alpha Channel Preserved**

   - Alpha channel (transparency) is never modified
   - Ensures image transparency is maintained

4. **Lossless for PNG**
   - PNG format preserves exact pixel values
   - No compression artifacts
   - Perfect reconstruction possible

### Visual Comparison

```
Original Image:     [150, 200, 100]
                    ↓ (embed bit '1')
Watermarked Image:  [151, 200, 100]
                    ↓ (visual appearance)
Human Perception:   IDENTICAL (cannot detect difference)
```

### Real-World Test

Try this:

1. Load an image in ImageChain
2. Commit a version (embeds history)
3. Compare original vs watermarked
4. **Result**: Visually identical, even at 100% zoom

---

## DCT Frequency-Domain Embedding

### Why DCT?

**The Problem with LSB:**

- LSB data is lost when images are re-encoded as JPEG
- Pixel values change during compression → LSB bits change
- Heavy edits corrupt LSB-embedded data

**The Solution: Frequency Domain**

- **DCT (Discrete Cosine Transform)** embeds data in frequency components
- JPEG uses DCT internally → data survives compression
- Mid-frequency coefficients are preserved during quantization

### Hybrid Embedding Approach

ImageChain uses a **dual-layer system**:

1. **DCT Layer** (Frequency Domain):

   - Critical metadata: `chain_id`, `version_count`, `last_version_hash`
   - Embedded in quantized DCT coefficients (8x8 blocks)
   - Survives JPEG compression and re-encoding

2. **LSB Layer** (Spatial Domain):
   - Full version history with all details
   - Embedded in pixel LSBs
   - Available when image is not heavily compressed

### Embedding Process

```javascript
// Step 1: Extract critical metadata
const criticalMetadata = {
    chain_id: payload.chain_id,           // 256 bits
    version_count: payload.history.length, // 16 bits
    last_version_hash: lastVersion.sha256, // 256 bits
    checksum: calculateChecksum(...)      // 32 bits
};

// Step 2: Embed in DCT domain (8x8 blocks)
embedCriticalMetadataDCT(canvas, criticalMetadata);

// Step 3: Embed full history in LSB domain
embedPayloadLSB(canvas, payload);
```

### Extraction Process

```javascript
// Step 1: Try DCT extraction first (survives JPEG)
const criticalMetadata = extractCriticalMetadataDCT(canvas);
if (criticalMetadata) {
  // Critical metadata recovered ✓
}

// Step 2: Try LSB extraction (full history)
const fullPayload = extractPayloadLSB(canvas);
if (fullPayload) {
  // Complete history available ✓
} else if (criticalMetadata) {
  // Partial recovery: critical metadata only
}
```

### Benefits

✅ **Survives JPEG Compression**: Critical metadata in frequency domain  
✅ **Dual-Layer Protection**: DCT + LSB provide maximum robustness  
✅ **Graceful Degradation**: Partial recovery when LSB fails  
✅ **Backward Compatible**: Old images (LSB only) still work

### Technical Details

- **Block Size**: 8x8 pixels (DCT standard, same as JPEG)
- **Embedding Method**: Quantized coefficient LSB
- **Quantization Step**: 16 (similar to JPEG quantization)
- **Capacity**: ~560 bits (critical metadata only)
- **Marker**: "CMT" (Critical Metadata)

See [DCT_EMBEDDING.md](DCT_EMBEDDING.md) for complete implementation details.

---

## Complete Workflow: Commit to Extraction

### Phase 1: Creating a New Version

#### Step 1: User Makes Edits

```javascript
// User adjusts brightness, adds filter, etc.
const edits: EditOperation[] = [
  { op: 'brightness', delta: 1.5 },
  { op: 'filter', type: 'sepia' },
  { op: 'text', text: 'v2', x: 64, y: 64, ... }
];
```

#### Step 2: Apply Edits to Canvas

```javascript
// Create canvas with edits applied
const canvas = document.createElement("canvas");
canvas.width = image.width;
canvas.height = image.height;
const ctx = canvas.getContext("2d");

// Apply filters
ctx.filter = "brightness(150%) sepia(100%)";
ctx.drawImage(image, 0, 0);

// Add text overlay
ctx.fillText("v2", 64, 64);
```

#### Step 3: Compute Image Hash

```javascript
// Convert canvas to blob
const blob = await canvas.toBlob(canvas, "image/png");
const buffer = await blob.arrayBuffer();

// Compute SHA-256 hash
const currentHash = await sha256(buffer);
// Result: "a1b2c3d4e5f6..." (64 hex characters)
```

**Why hash the image?**

- Creates unique fingerprint for this version
- Links versions together (parent_hash)
- Detects any modifications

#### Step 4: Create Version Entry

```javascript
const lastVersion = history[history.length - 1]; // Previous version

const entryToSign: HistoryEntry = {
  version: lastVersion ? lastVersion.version + 1 : 1,
  sha256: currentHash, // Hash of THIS version's image
  parent_hash: lastVersion ? lastVersion.sha256 : null, // Links to previous
  timestamp: new Date().toISOString(),
  signer: "User Name",
  sig_scheme: SigScheme.ECC,
  edit_log: edits, // What changes were made
  snapshot: await createSnapshot(canvas), // Compressed preview
  signature: "", // Will be added next
};
```

**Key Points:**

- `parent_hash` creates the chain link
- `snapshot` is a compressed preview (128x128 WebP)
- `edit_log` records all operations

#### Step 5: Create Snapshot (Optional)

```javascript
// Only created if edits are "destructive" (filters, etc.)
const snapshot = await createSnapshot(canvas, 128);

// Process:
// 1. Create smaller canvas (128x128)
// 2. Draw scaled-down version
// 3. Convert to WebP (80% quality)
// 4. Encode as base64
// Result: Small preview image (~2-5 KB)
```

**Why snapshots?**

- Allows viewing previous versions without full image
- Compressed to save space
- Only created for "destructive" edits

#### Step 6: Sign the Version Entry

```javascript
// Create stable string representation
const header = getPayloadHeader(entryToSign);
// Result: Sorted JSON string (deterministic)

// Sign with private key
const signature = await signPayload(header, privateKeyPem, SigScheme.ECC);
// Process:
// 1. Import private key from PEM
// 2. Encode header as bytes
// 3. Sign using Web Crypto API
// 4. Encode signature as base64

// Add signature to entry
const signedEntry: HistoryEntry = {
  ...entryToSign,
  signature: signature, // Base64 encoded signature
};
```

**Cryptographic Signing Process:**

```
Header Data → SHA-256 Hash → Sign with Private Key → Base64 Signature
```

#### Step 7: Update History

```javascript
// Add new version to history
history.push(signedEntry);

// Create complete payload
const payload: ChainedPayload = {
  chain_id: originalImageHash, // Never changes
  history: history, // All versions, including new one
};
```

**Important:** The entire history is re-embedded each time!

#### Step 8: Embed Payload in Image

```javascript
// 1. Convert payload to JSON
const jsonString = JSON.stringify(payload);

// 2. Compress
const compressed = pako.deflate(jsonString);

// 3. Convert to binary string
const binary = stringToBinary(compressedString) + END_MARKER;

// 4. Embed in image pixels (LSB steganography)
embedPayload(canvas, payload);
```

**Result:** Image now contains complete version history invisibly embedded!

### Phase 2: Extracting History

#### Step 1: Load Image

```javascript
// User uploads ImageChain file
const file = event.target.files[0];
const img = await loadImage(file);
```

#### Step 2: Extract Pixel Data

```javascript
// Create canvas from image
const canvas = document.createElement("canvas");
canvas.width = img.width;
canvas.height = img.height;
const ctx = canvas.getContext("2d");
ctx.drawImage(img, 0, 0);

// Get pixel data
const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
const data = imageData.data; // [R, G, B, A, R, G, B, A, ...]
```

#### Step 3: Read LSBs

```javascript
const bits: string[] = [];

for (let i = 0; i < data.length; i++) {
  // Skip alpha channel
  if ((i + 1) % 4 === 0) continue;

  // Extract LSB (rightmost bit)
  const lsb = data[i] & 1; // Bitwise AND with 1
  bits.push(lsb.toString()); // '0' or '1'

  // Check for END marker
  if (bits.length >= END_MARKER.length) {
    const lastBits = bits.slice(-END_MARKER.length).join("");
    if (lastBits === END_MARKER) {
      // Found end of payload!
      break;
    }
  }
}
```

**How LSB extraction works:**

```
Pixel value: 151
Binary:       10010111
              ↑
              LSB = 1 (extracted)

Pixel value: 150
Binary:       10010110
              ↑
              LSB = 0 (extracted)
```

#### Step 4: Reconstruct Binary Data

```javascript
// Remove END marker
const payloadBits = bits.slice(0, -END_MARKER.length);

// Convert binary string to character string
const compressedString = binaryToString(payloadBits.join(""));

// Convert string to bytes
const compressedBytes = new Uint8Array(compressedString.length);
for (let i = 0; i < compressedString.length; i++) {
  compressedBytes[i] = compressedString.charCodeAt(i);
}
```

#### Step 5: Decompress

```javascript
// Decompress using DEFLATE
const decompressed = pako.inflate(compressedBytes, { to: "string" });

// Parse JSON
const payload: ChainedPayload = JSON.parse(decompressed);
```

**Result:** Complete version history extracted!

#### Step 6: Verify Signatures (Optional)

```javascript
for (const entry of payload.history) {
  // 1. Recreate header (same way it was signed)
  const header = getPayloadHeader(entry);

  // 2. Verify signature
  const isValid = await verifySignature(
    header,
    entry.signature,
    publicKeyPem,
    entry.sig_scheme
  );

  // 3. Verify chain link
  const isChainValid = entry.parent_hash === previousHash;

  // Result: Both checks must pass
}
```

---

## Cryptographic Mechanisms

### 1. Key Generation

```javascript
// Generate ECC P-256 key pair
const { privateKey, publicKey } = await crypto.subtle.generateKey(
  {
    name: "ECDSA",
    namedCurve: "P-256", // Elliptic curve
  },
  true, // Extractable
  ["sign", "verify"] // Key usage
);
```

**Key Properties:**

- **Private Key**: Used to sign versions (KEEP SECRET!)
- **Public Key**: Used to verify signatures (can be shared)
- **ECC P-256**: 256-bit security, smaller keys than RSA
- **RSA Alternative**: 3072-bit RSA-PSS also supported

### 2. Signing Process

```javascript
// 1. Create deterministic JSON string
const header = JSON.stringify(entry, Object.keys(entry).sort());
// Sorting ensures same data = same string

// 2. Encode as bytes
const data = new TextEncoder().encode(header);

// 3. Sign with private key
const signature = await crypto.subtle.sign(
  {
    name: "ECDSA",
    hash: "SHA-256",
  },
  privateKey,
  data
);

// 4. Encode as base64
const signatureB64 = btoa(String.fromCharCode(...new Uint8Array(signature)));
```

**What gets signed:**

- Version number
- Image hash (SHA-256)
- Parent hash
- Timestamp
- Signer name
- Edit log
- Snapshot
- **NOT the signature itself** (would be circular)

### 3. Verification Process

```javascript
// 1. Recreate header (must be identical to signing)
const header = getPayloadHeader(entry);

// 2. Encode as bytes
const data = new TextEncoder().encode(header);

// 3. Decode signature from base64
const signature = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));

// 4. Verify with public key
const isValid = await crypto.subtle.verify(
  {
    name: "ECDSA",
    hash: "SHA-256",
  },
  publicKey,
  signature,
  data
);
```

**Result:**

- `true`: Signature is valid, data hasn't been tampered with
- `false`: Signature invalid, data was modified or key doesn't match

### 4. Why Signatures Matter

**Without signatures:**

- Anyone could modify version history
- No way to detect tampering
- No proof of authenticity

**With signatures:**

- Cannot modify history without breaking signature
- Can verify who created each version
- Mathematical proof of authenticity

---

## Hash Chain Architecture

### What is a Hash Chain?

A **hash chain** links versions together using cryptographic hashes. Each version contains the hash of the previous version.

### Structure

```
Version 1:
  sha256: "abc123..."
  parent_hash: null  ← First version, no parent

Version 2:
  sha256: "def456..."
  parent_hash: "abc123..."  ← Links to Version 1

Version 3:
  sha256: "ghi789..."
  parent_hash: "def456..."  ← Links to Version 2
```

### How It Works

#### Creating the Chain

```javascript
let previousHash = null;

for (const entry of history) {
  // Compute hash of current version's image
  const currentHash = await sha256(imageBuffer);

  // Set parent_hash to previous version's hash
  entry.parent_hash = previousHash;
  entry.sha256 = currentHash;

  // Update for next iteration
  previousHash = currentHash;
}
```

#### Verifying the Chain

```javascript
let previousHash = null;

for (const entry of history) {
  // Check if parent_hash matches previous version
  if (entry.parent_hash !== previousHash) {
    // Chain broken!
    return false;
  }

  // Verify this version's hash matches its image
  const computedHash = await sha256(entry.imageBuffer);
  if (computedHash !== entry.sha256) {
    // Hash mismatch!
    return false;
  }

  previousHash = entry.sha256;
}
```

### Why Hash Chains Matter

**Tamper Detection:**

- If Version 2 is modified, its hash changes
- Version 3's `parent_hash` no longer matches
- Chain verification fails immediately

**Order Verification:**

- Cannot reorder versions
- Cannot insert fake versions
- Cannot remove versions

**Immutable History:**

- Once committed, cannot be changed
- Any modification breaks the chain
- Cryptographic guarantee

### Chain ID

```javascript
const chain_id = await sha256(originalImageBuffer);
// Computed once, never changes
// All versions share the same chain_id
```

**Purpose:**

- Identifies all versions from the same original image
- Prevents mixing versions from different images
- Provides origin tracking

---

## Data Flow Diagrams

### Complete Commit Flow

```
User Edits Image
    ↓
Apply Edits to Canvas
    ↓
Compute SHA-256 Hash of Image
    ↓
Create Version Entry
    ├─ version number
    ├─ sha256 (current image hash)
    ├─ parent_hash (previous version hash)
    ├─ timestamp
    ├─ signer
    ├─ edit_log
    └─ snapshot (optional)
    ↓
Sign Version Entry with Private Key
    ↓
Add to History Array
    ↓
Create ChainedPayload
    ├─ chain_id (original image hash)
    └─ history (all versions)
    ↓
Convert to JSON
    ↓
Compress with DEFLATE
    ↓
Convert to Binary String
    ↓
Add END Marker
    ↓
Embed in Image Pixels (LSB Steganography)
    ↓
Save Watermarked Image
```

### Complete Extraction Flow

```
Load Image File
    ↓
Extract Pixel Data
    ↓
Read LSBs from Pixels
    ↓
Find END Marker
    ↓
Convert Binary to String
    ↓
Decompress with DEFLATE
    ↓
Parse JSON to ChainedPayload
    ↓
Extract History Array
    ↓
For Each Version Entry:
    ├─ Verify Signature (optional)
    ├─ Verify Chain Link
    └─ Display Version Info
    ↓
Show Complete History
```

---

## Extraction and Root Tracing

### How Root Tracing Works

When you extract history from an ImageChain file, you can trace back to the original version:

#### Step 1: Extract Payload

```javascript
const payload = await extractPayloadAsync(canvas);
// Contains: { chain_id, history: [v1, v2, v3, ...] }
```

#### Step 2: Identify Original

```javascript
// Version 1 is always the original
const original = payload.history[0];

// Verify it's the original:
// - version === 1
// - parent_hash === null
// - chain_id matches original image hash
```

#### Step 3: Trace the Chain

```javascript
// Start from latest version
let current = payload.history[payload.history.length - 1];

// Trace backwards
const chain = [];
while (current) {
  chain.unshift(current); // Add to front

  // Find parent
  if (current.parent_hash) {
    current = payload.history.find((v) => v.sha256 === current.parent_hash);
  } else {
    current = null; // Reached original
  }
}

// Result: [v1, v2, v3, ...] in order
```

#### Step 4: Verify Integrity

```javascript
// Verify each link in the chain
for (let i = 1; i < chain.length; i++) {
  const current = chain[i];
  const previous = chain[i - 1];

  // Check parent_hash matches
  if (current.parent_hash !== previous.sha256) {
    console.error("Chain broken at version", current.version);
    return;
  }

  // Verify signature
  const isValid = await verifySignature(
    getPayloadHeader(current),
    current.signature,
    publicKeyPem,
    current.sig_scheme
  );

  if (!isValid) {
    console.error("Invalid signature at version", current.version);
    return;
  }
}
```

### Complete Root Tracing Example

```
ImageChain File (v5)
    ↓
Extract Payload
    ↓
History: [v1, v2, v3, v4, v5]
    ↓
Trace Backwards:
    v5 → parent_hash → v4
    v4 → parent_hash → v3
    v3 → parent_hash → v2
    v2 → parent_hash → v1
    v1 → parent_hash → null (ORIGINAL!)
    ↓
Verify Chain:
    ✓ v5.parent_hash === v4.sha256
    ✓ v4.parent_hash === v3.sha256
    ✓ v3.parent_hash === v2.sha256
    ✓ v2.parent_hash === v1.sha256
    ✓ v1.parent_hash === null
    ↓
Verify Signatures:
    ✓ v1 signature valid
    ✓ v2 signature valid
    ✓ v3 signature valid
    ✓ v4 signature valid
    ✓ v5 signature valid
    ↓
Result: Complete, verified chain from v1 (root) to v5 (current)
```

### What You Can Extract

From a single ImageChain file, you can extract:

1. **Complete Version History**

   - All versions from original to current
   - Version numbers, timestamps, signers

2. **Edit Logs**

   - What changes were made in each version
   - Brightness, contrast, filters, text overlays

3. **Snapshots**

   - Compressed previews of each version
   - Allows viewing previous versions

4. **Hash Chain**

   - SHA-256 hashes of each version
   - Parent-child relationships

5. **Cryptographic Proof**

   - Signatures for each version
   - Verification status

6. **Chain ID**
   - Original image identifier
   - Proves all versions from same source

### No Public Key Needed for Extraction

**Important:** You can extract ALL of the above without a public key!

The public key is only needed for **verification** (checking if signatures are valid).

---

## Summary

### Key Mechanisms

1. **LSB Steganography**: Hides data in least significant bits (imperceptible)
2. **DEFLATE Compression**: Reduces payload size by 70-90%
3. **Cryptographic Signing**: Each version signed with private key
4. **Hash Chains**: Versions linked via SHA-256 hashes
5. **Chain ID**: Identifies original source image

### Why It Works

- **Quality**: LSB changes are imperceptible (<0.67% per pixel)
- **Security**: Cryptographic signatures prevent tampering
- **Integrity**: Hash chains detect any modifications
- **Portability**: Everything in one file, no external dependencies
- **Verifiability**: Public key verification proves authenticity

### The Magic

The entire version history—potentially 15+ versions with full metadata, signatures, and snapshots—is invisibly embedded in the image file itself, with **zero visible quality loss** and **cryptographic proof of authenticity**.

This is the power of combining steganography, cryptography, hash chains, and error correction!

---

## Tamper Detection When Data is Lost

### The Challenge

When images are heavily edited or re-encoded (especially as JPEG), LSB data can be completely lost. However, ImageChain can still **detect tampering** even in these cases.

### Detection Mechanism

**Hash Chain Verification:**

1. **If extraction succeeds:**

   - Verify signatures ✓
   - Verify hash chain links ✓
   - Compare current image hash to last version ✓

2. **If extraction fails:**
   - Cannot read embedded history
   - **BUT**: If public key is available:
     - Compute current image hash
     - Compare to expected hash (if known)
     - **Mismatch = tampering detected** ✓

### Implementation

```javascript
// During verification
const currentImageHash = await sha256(imageBuffer);
const lastVersionHash = payload.history[payload.history.length - 1].sha256;

if (currentImageHash !== lastVersionHash) {
  // Tampering detected!
  verification.corruptionDetected = true;
  verification.error = "Image hash mismatch. Image modified since last commit.";
}
```

### Use Cases

**Scenario 1: JPEG Re-encoding**

- LSB data lost (JPEG compression)
- Extraction fails
- Hash verification detects modification ✓

**Scenario 2: Heavy Brightness Edit**

- LSB data corrupted
- Error correction may recover
- If recovery fails, hash verification detects ✓

**Scenario 3: External Edit**

- Image edited in Photoshop
- Re-uploaded to ImageChain
- Hash mismatch detected ✓

### Limitations

- Requires public key for verification
- Cannot recover history if data is lost
- Can only detect, not recover, when data is lost

### Future: Robust Watermarking

For better protection against data loss, future versions may use:

- **DCT (Discrete Cosine Transform)**: Frequency-domain embedding survives JPEG
- **DWT (Discrete Wavelet Transform)**: Multi-resolution, more robust
- **Multiple Embeddings**: Redundant copies in different regions

These techniques would allow data recovery even after JPEG re-encoding.
