# Tamper Detection: Even When Data is Lost

## Overview

ImageChain can **detect tampering** even when the embedded LSB data is completely lost (JPEG re-encoding, heavy edits). This is achieved through **hash chain verification** combined with **cryptographic signatures**.

---

## The Problem

When images are edited or re-encoded:

- **Brightness/contrast changes**: Pixel values change → LSB bits change → embedded data corrupted
- **JPEG re-encoding**: Compression recalculates pixels → LSB data completely lost
- **External edits**: Photoshop, GIMP, etc. → Pixel values modified → data lost

**Result**: LSB extraction may fail, but **critical metadata survives via DCT**, and **tampering can still be detected**.

---

## How It Works

### Scenario 1: Extraction Succeeds

```
1. Extract embedded history ✓
2. Verify signatures ✓
3. Verify hash chain links ✓
4. Compare current image hash to last version ✓
5. All checks pass → History intact
```

### Scenario 2: LSB Extraction Fails (Data Lost)

```
1. Try DCT extraction → Critical metadata recovered ✓ (if available)
2. Try LSB extraction → Full history ✗ (data corrupted/lost)
3. If DCT succeeded:
   - Have chain_id, version_count, last_hash
   - Can verify chain identity
4. If public key available:
   a. Compute current image's SHA-256 hash
   b. Compare to last version's hash (from DCT or known)
   c. Mismatch = tampering detected ✓
```

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

---

## Real-World Examples

### Example 1: JPEG Re-encoding

```
Original: ImageChain file (PNG, v5)
Action:   Re-saved as JPEG
Result:
  - LSB data lost (JPEG compression)
  - DCT extraction: Critical metadata recovered ✓
  - Have: chain_id, version_count (5), last_hash
  - Hash verification: current_hash ≠ v5.sha256
  - Status: "⚠️ LSB data lost, but critical metadata recovered from DCT. Image hash mismatch. Tampering detected."
```

### Example 2: Brightness Adjustment

```
Original: ImageChain file (v3)
Action:   Brightness +50% in external editor
Result:
  - LSB data corrupted
  - Error correction may recover (if <33% errors)
  - If recovery fails: Hash verification detects
  - Status: "⚠️ Data corruption detected" or "⚠️ Image hash mismatch"
```

### Example 3: External Edit

```
Original: ImageChain file (v2)
Action:   Edited in Photoshop, re-uploaded
Result:
  - Pixel values changed
  - LSB data corrupted/lost
  - Hash verification: current_hash ≠ v2.sha256
  - Status: "⚠️ Image hash mismatch. Image modified since last commit."
```

---

## Protection Layers

ImageChain uses **multiple layers** of tamper detection:

### Layer 1: Embedded Data Verification

- **Checksum**: Detects corruption in extracted data
- **Error Correction**: Recovers from minor corruption
- **Status**: Works when data is recoverable

### Layer 2: Hash Chain Verification

- **Image Hash**: Each version stores SHA-256 of image
- **Parent Hash**: Links versions together
- **Status**: Works even when embedded data is lost

### Layer 3: Cryptographic Signatures

- **Version Signatures**: Each version cryptographically signed
- **Signature Verification**: Detects modified history entries
- **Status**: Works if embedded data can be extracted

### Layer 4: Chain ID Verification

- **Original Hash**: Identifies source image
- **Chain Consistency**: All versions share same chain_id
- **Status**: Detects mixing of different image chains

---

## What Gets Detected

### ✅ Detected (Even When Data is Lost)

- **Image modifications** (brightness, contrast, filters)
- **JPEG re-encoding** (LSB lost, but DCT metadata survives)
- **External edits** (Photoshop, GIMP, etc.)
- **Pixel value changes** (any modification to image)
- **History tampering** (if embedded data extractable)
- **Critical metadata recovery** (via DCT even when LSB fails)

### ⚠️ Limitations

- **Requires public key** for hash verification
- **Cannot recover history** if data is lost
- **Cannot detect** if no public key and extraction fails
- **Cropping/rotation** loses data but hash detects modification

---

## User Experience

### When Extraction Fails

**Without Public Key:**

```
Status: "Could not extract payload"
Action: Cannot verify (need public key)
```

**With Public Key:**

```
Status: "Could not extract payload"
        "⚠️ Image hash mismatch. Tampering detected."
Action: Tampering detected via hash verification ✓
```

### When Extraction Succeeds

**With Public Key:**

```
Status: "Data extracted successfully"
        "✓ All signatures valid"
        "✓ Hash chain intact"
        "✓ Image hash matches"
Action: Complete verification ✓
```

---

## Best Practices

1. **Always keep your public key** - Needed for tamper detection
2. **Use PNG format** - Preserves LSB data better than JPEG
3. **Avoid re-encoding** - Don't save as JPEG after embedding
4. **Share public keys** - Allow others to verify your chains
5. **Verify after edits** - Check if data survived modifications

---

## Current Implementation

### Hybrid Embedding (Implemented)

ImageChain now uses:

- **DCT (Discrete Cosine Transform)**: Frequency-domain embedding ✓

  - Critical metadata embedded in DCT domain
  - Survives JPEG compression
  - Provides backup when LSB fails

- **LSB (Least Significant Bit)**: Spatial-domain embedding ✓
  - Full history embedded in pixel LSBs
  - Maximum capacity
  - Works when image is not heavily compressed

### Future Enhancements

For even better data survival:

- **Full DCT Implementation**: Complete 2D DCT transform (currently simplified)
- **DWT (Discrete Wavelet Transform)**: Multi-resolution embedding

  - Survives scaling and rotation
  - More robust to edits
  - Better error recovery

- **Multiple Embeddings**: Redundant copies
  - Store data in multiple image regions
  - Survives cropping and local edits
  - Higher recovery rate

---

## Summary

**Key Point**: Even when LSB data is lost, ImageChain can **recover critical metadata via DCT** and **detect tampering** through hash chain verification. This provides cryptographic proof of modification and partial data recovery even after JPEG compression.

**The System:**

- ✅ Detects tampering (hash verification)
- ✅ Recovers critical metadata (DCT embedding)
- ✅ Recovers from minor edits (error correction)
- ✅ Verifies authenticity (signatures)
- ✅ Partial recovery even after JPEG re-encoding (DCT layer)
- ✅ Can still prove tampering occurred

This makes ImageChain robust against both data corruption and intentional tampering.
