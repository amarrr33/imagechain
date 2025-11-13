# How ImageChain Prevents Cloning & Duplication

## Overview

ImageChain uses multiple cryptographic and structural mechanisms to prevent image cloning, duplication, and history tampering. This document explains how each protection mechanism works and why they're effective.

---

## Table of Contents

1. [Protection Mechanisms](#protection-mechanisms)
2. [Cloning Attack Scenarios](#cloning-attack-scenarios)
3. [Verification Process](#verification-process)
4. [Key Takeaways](#key-takeaways)
5. [Limitations](#limitations)
6. [Best Practices](#best-practices)

---

## Protection Mechanisms

ImageChain employs multiple layers of protection against cloning and tampering:

### 1. Cryptographic Signatures

**How it works:**

- Each version is cryptographically signed using the private key
- The signature covers all version metadata (version number, hash, timestamp, edits, etc.)
- Without the private key, signatures cannot be forged

**Prevents:**

- Creating fake versions with forged signatures
- Modifying existing version entries
- Adding unauthorized versions to the chain

**Example:**

```
Version 1: Signed with Private Key A → Signature A1
Version 2: Signed with Private Key A → Signature A2
Clone Attempt: Tries to create Version 3 without Private Key A → ❌ Cannot forge Signature A3
```

### 2. Hash Chain Linking

**How it works:**

- Each version contains the SHA-256 hash of the previous version (`parent_hash`)
- Versions form an unbreakable chain: v1 → v2 → v3 → ...
- If any version is modified, its hash changes, breaking the chain

**Prevents:**

- Removing versions from history
- Reordering versions
- Inserting fake versions in the middle
- Modifying any version's data

**Example:**

```
v1: hash = abc123, parent_hash = null
v2: hash = def456, parent_hash = abc123  ← Links to v1
v3: hash = ghi789, parent_hash = def456  ← Links to v2

If someone modifies v2:
- v2's hash changes to xyz999
- v3's parent_hash (def456) no longer matches v2's new hash
- Chain is broken → Verification fails ❌
```

### 3. Chain ID (Original Image Hash)

**How it works:**

- The original, un-watermarked image is hashed to create a `chain_id`
- This `chain_id` remains constant for all versions from the same original
- All versions in a chain share the same `chain_id`

**Prevents:**

- Mixing versions from different original images
- Creating fake chains that claim to be from a different original
- Cloning an image and claiming it's from a different source

**Example:**

```
Original Image A → chain_id = "abc123..."
  - Version 1: chain_id = "abc123..."
  - Version 2: chain_id = "abc123..."
  - Version 3: chain_id = "abc123..."

Cloned Image B → chain_id = "xyz789..." (different!)
  - Cannot claim to be part of Image A's chain
```

### 4. Immutable History Structure

**How it works:**

- Version history is embedded directly in the image using steganography
- Each new version rebuilds the entire history and re-embeds it
- History cannot be selectively modified without breaking signatures

**Prevents:**

- Selective history deletion
- History rewriting
- Partial chain modification

**Example:**

```
Version 3 contains:
  - History: [v1, v2, v3]
  - All signed and linked

If someone tries to remove v2:
  - v3's parent_hash would need to point to v1
  - But v3's signature was created with v2 in the chain
  - Signature verification fails ❌
```

### 5. DCT Frequency-Domain Embedding

**How it works:**

- Critical metadata (chain_id, version_count, last_hash) embedded in DCT domain
- Survives JPEG compression and re-encoding
- Provides backup layer when LSB data is lost
- Enables tamper detection even after heavy compression

**Prevents:**

- Complete data loss from JPEG re-encoding
- Loss of critical metadata during compression
- Inability to verify chain after image edits

**Benefits:**

- **JPEG-robust**: Critical metadata survives compression
- **Dual-layer**: DCT + LSB provide maximum protection
- **Recovery**: Can extract chain_id and version info even when full history is lost

**Example:**

```
Image re-saved as JPEG:
  - LSB data lost ✗
  - DCT metadata survives ✓
  - Can still verify chain_id and version_count
  - Hash verification detects tampering ✓
```

### 6. Tamper Detection

**How it works:**

- Verification checks both signature validity AND chain link validity
- Any modification to history breaks one or both checks
- Failed verification immediately indicates tampering

**Prevents:**

- Undetected modifications
- Silent history corruption
- Successful cloning attempts

## Cloning Attack Scenarios

### Scenario 1: Simple Copy-Paste Clone

**Attack:** Someone copies an ImageChain file and claims it as their own.

**Protection:**

- The clone has the same signatures, but they were created with the original owner's private key
- If the clone tries to verify with their own public key → ❌ Verification fails
- If they try to add new versions → ❌ Cannot sign without original private key

**Result:** Clone is detectable and cannot be extended without the original private key.

### Scenario 2: History Modification

**Attack:** Someone modifies the embedded history to remove or change versions.

**Protection:**

- Modifying any version changes its hash
- This breaks the hash chain (parent_hash links)
- Signatures no longer match the modified data
- Verification fails on multiple levels

**Result:** Tampering is immediately detected.

### Scenario 3: Fake Version Injection

**Attack:** Someone tries to insert a fake version into the middle of the chain.

**Protection:**

- Cannot create valid signature without private key
- Even if they modify existing versions, hash chain breaks
- Chain ID remains constant, so fake version is identifiable

**Result:** Injection fails - cannot create valid signatures or maintain chain integrity.

### Scenario 4: Complete History Rewrite

**Attack:** Someone tries to create a completely new history for an image.

**Protection:**

- Cannot sign new versions without the original private key
- Chain ID would be different (based on original image hash)
- All signatures would fail verification

**Result:** Rewrite fails - no valid signatures possible.

## Verification Process

When verifying an ImageChain file:

1. **Extract History** (no key needed)

   - Read embedded data from image pixels
   - Reconstruct version history

2. **Verify Signatures** (public key needed)

   - Check each version's signature against public key
   - Confirm signatures are authentic

3. **Verify Chain Links**

   - Check each version's `parent_hash` matches previous version's hash
   - Confirm chain is unbroken

4. **Verify Chain ID**
   - Confirm all versions share the same `chain_id`
   - Confirm `chain_id` matches original image hash

## Key Takeaways

### What Clones Cannot Do

✅ **Cannot forge signatures** - Private key is required  
✅ **Cannot modify history** - Hash chains break  
✅ **Cannot extend chains** - Cannot sign new versions  
✅ **Cannot hide tampering** - Verification detects all modifications  
✅ **Cannot alter committed history** - Once committed, cannot be changed

### Detection Capabilities

✅ **Signature verification** - Detects forged or modified signatures  
✅ **Hash chain verification** - Detects broken chain links  
✅ **Image hash comparison** - Detects image modifications (even when embedded data is lost)  
✅ **Checksum verification** - Detects data corruption  
✅ **Chain ID verification** - Detects mixing of different image chains

## Limitations

⚠️ **Note:** ImageChain protects the **version history**, not the image content itself. If someone:

- Takes a screenshot of an ImageChain image
- Re-encodes the image (JPEG compression, etc.)
- Edits the image outside the app

The embedded history may be lost or corrupted. However, if they try to claim it's an original ImageChain file, verification will fail.

## Best Practices

1. **Keep your private key secure** - Never share it
2. **Share public keys for verification** - Allow others to verify your chains
3. **Verify before trusting** - Always verify ImageChain files before accepting them
4. **Use original files** - Avoid re-encoding or heavy compression of ImageChain files
