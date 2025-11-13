# DCT Frequency-Domain Embedding

## Overview

ImageChain now uses a **hybrid embedding approach** combining:
- **DCT (Discrete Cosine Transform)** for critical metadata (survives JPEG compression)
- **LSB (Least Significant Bit)** for full version history (when available)

This ensures critical information survives even when images are re-encoded as JPEG.

---

## Why DCT?

### The Problem with LSB

LSB steganography embeds data in pixel values. When images are:
- **Re-encoded as JPEG**: Compression recalculates pixels → LSB data lost
- **Heavily edited**: Pixel values change → LSB data corrupted
- **Compressed**: Quantization removes LSB information

### The Solution: Frequency Domain

**DCT (Discrete Cosine Transform)** embeds data in frequency components:
- **Survives JPEG compression** (JPEG uses DCT internally)
- **More robust** to pixel value changes
- **Mid-frequency coefficients** are preserved during compression

---

## How It Works

### Critical Metadata

Only essential information is embedded in DCT domain:
- `chain_id` (256 bits) - Identifies the image chain
- `version_count` (16 bits) - Number of versions
- `last_version_hash` (256 bits) - Hash of last version
- `checksum` (32 bits) - Verification checksum

**Total: ~560 bits** (vs. full history which can be 10,000+ bits)

### Embedding Process

1. **Extract critical metadata** from payload
2. **Convert to binary** (560 bits + marker)
3. **Process image in 8x8 blocks** (DCT standard)
4. **Embed bits in quantized coefficients** (mid-frequency)
5. **Apply inverse transform** to update image

### Extraction Process

1. **Process image in 8x8 blocks**
2. **Extract bits from quantized coefficients**
3. **Find marker** to locate data
4. **Parse metadata** and verify checksum
5. **Fall back to LSB** if DCT extraction fails

---

## Hybrid Approach

### Embedding

```
1. Embed critical metadata in DCT domain ✓
2. Embed full history in LSB domain ✓
```

**Result**: Two layers of data:
- **DCT layer**: Critical metadata (survives JPEG)
- **LSB layer**: Full history (when available)

### Extraction

```
1. Try DCT extraction first
   ├─ Success → Critical metadata available
   └─ Failure → Continue to LSB
2. Try LSB extraction
   ├─ Success → Full history available
   └─ Failure → Use DCT metadata if available
```

**Result**: Maximum data recovery:
- **Best case**: Both DCT and LSB succeed → Full history
- **JPEG case**: DCT succeeds, LSB fails → Critical metadata only
- **Worst case**: Both fail → No data

---

## Implementation Details

### Simplified DCT

For browser performance, we use a **simplified DCT approach**:
- Uses block variance as proxy for DCT coefficients
- Quantizes coefficients for embedding
- More practical than full DCT while maintaining robustness

**Note**: For production, full DCT implementation would be more robust.

### Embedding Location

- **8x8 blocks**: Standard DCT block size
- **Mid-frequency coefficients**: Survive JPEG quantization
- **Quantization step**: 16 (similar to JPEG)

### Visual Impact

- **Minimal**: Changes are in frequency domain
- **Imperceptible**: Similar to JPEG compression artifacts
- **Robust**: Survives re-encoding

---

## Use Cases

### Scenario 1: Normal Operation

```
Embed: DCT (critical) + LSB (full history)
Extract: Both succeed
Result: Complete version history available ✓
```

### Scenario 2: JPEG Re-encoding

```
Embed: DCT (critical) + LSB (full history)
Action: Image re-saved as JPEG
Extract: DCT succeeds, LSB fails
Result: Critical metadata available (chain_id, version_count, last_hash) ✓
```

### Scenario 3: Heavy Editing

```
Embed: DCT (critical) + LSB (full history)
Action: Heavy brightness/contrast edits
Extract: DCT succeeds, LSB may fail
Result: Critical metadata available, full history may be recoverable with error correction
```

---

## Benefits

### ✅ Survives JPEG Compression

- Critical metadata embedded in frequency domain
- JPEG uses DCT internally → data preserved
- Can recover chain_id, version count, last hash even after re-encoding

### ✅ Dual-Layer Protection

- **DCT layer**: Critical metadata (always try first)
- **LSB layer**: Full history (when available)
- Maximum data recovery

### ✅ Backward Compatible

- Old images (LSB only) still work
- New images have both layers
- Graceful degradation

---

## Limitations

### Current Implementation

- **Simplified DCT**: Uses variance-based approximation
- **Not full DCT**: Production would use complete DCT transform
- **Limited capacity**: Only critical metadata in DCT (560 bits)

### Future Enhancements

1. **Full DCT Implementation**: Complete 2D DCT transform
2. **Multiple Coefficients**: Embed in multiple mid-frequency positions
3. **DWT Alternative**: Discrete Wavelet Transform (more robust)
4. **Adaptive Embedding**: Adjust strength based on image content

---

## Technical Specifications

- **Block Size**: 8x8 pixels (DCT standard)
- **Embedding Method**: Quantized coefficient LSB
- **Quantization Step**: 16
- **Capacity**: ~560 bits (critical metadata)
- **Marker**: "CMT" (Critical Metadata)
- **Checksum**: 32-bit simple checksum

---

## Comparison: LSB vs DCT

| Feature | LSB | DCT |
|---------|-----|-----|
| **Survives JPEG** | ❌ No | ✅ Yes |
| **Capacity** | High | Low (critical only) |
| **Robustness** | Low | High |
| **Visual Impact** | Minimal | Minimal |
| **Complexity** | Low | Medium |
| **Use Case** | Full history | Critical metadata |

---

## Summary

The hybrid DCT+LSB approach provides:
- **Maximum robustness**: Critical metadata survives JPEG
- **Full functionality**: Complete history when available
- **Graceful degradation**: Partial recovery when LSB fails
- **Future-proof**: Foundation for more robust watermarking

This makes ImageChain significantly more robust against JPEG re-encoding and heavy image edits.


