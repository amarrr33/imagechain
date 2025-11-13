# Quick Start Guide

A simple guide to get ImageChain running on your local computer.

---

## How to Run ImageChain Locally

### Step 1: Install Dependencies

Open a terminal in the project folder and run:

```bash
npm install
```

This will install all required packages (React, Vite, Tailwind CSS, etc.)

### Step 2: Start the Development Server

```bash
npm run dev
```

### Step 3: Open in Browser

The terminal will show something like:

```
  VITE v6.x.x  ready in xxx ms

  ➜  Local:   http://localhost:3000/
  ➜  Network: use --host to expose
```

Open your browser and go to: **http://localhost:3000**

That's it! The app runs entirely offline - no internet connection needed after installation.

---

## Understanding Public Keys vs. Viewing History

### ✅ You DON'T Need a Public Key To:

- **View version history** - Just upload an ImageChain file and click "Extract History"
- **See all versions** - All version information is embedded in the image
- **Read edit logs** - See what changes were made to each version
- **View snapshots** - See preview images of each version

### 🔐 You DO Need a Public Key To:

- **Verify signatures** - Confirm that versions were signed by the expected person
- **Detect tampering** - Check if the version history has been modified
- **Validate chain integrity** - Ensure the hash chain links are unbroken

### Example Use Case:

**Scenario:** You receive an ImageChain file from someone and want to see its history.

1. **Without Public Key:**

   - Upload the file → Click "Extract History"
   - You can see all versions, timestamps, edits, and snapshots
   - You just can't verify if the signatures are authentic

2. **With Public Key:**
   - Upload the file → Paste the public key → Click "Verify Signatures"
   - You see everything above PLUS verification status
   - You know if the history has been tampered with

**The key point:** The entire version history is stored IN the image file itself. You can always extract and view it. The public key is only needed to verify authenticity.

---

## Understanding Tamper Detection

### Even When Data is Lost

ImageChain can **detect tampering** even when embedded data is lost (e.g., JPEG re-encoding):

1. **If extraction fails** (data corrupted/lost):

   - System cannot read embedded history
   - **BUT**: If you provide the public key:
     - System computes current image's hash
     - Compares to last version's hash
     - **Mismatch = tampering detected** ✓

2. **Example:**
   - Image re-saved as JPEG (LSB data lost)
   - Extraction fails
   - Provide public key → Hash verification detects modification

### What This Means

✅ **Brightness/contrast edits**: Usually recoverable with error correction  
✅ **JPEG re-encoding**: LSB data lost, but **critical metadata survives via DCT embedding**  
✅ **Heavy edits**: May lose LSB data, but DCT metadata + hash verification work  
✅ **External edits**: Detected via hash comparison

### DCT Frequency-Domain Embedding

ImageChain uses a **hybrid approach**:

- **DCT layer**: Critical metadata (chain_id, version_count, last_hash) embedded in frequency domain
- **LSB layer**: Full version history embedded in pixel LSBs

**Benefits:**

- Critical metadata survives JPEG re-encoding (DCT domain)
- Full history available when LSB data is intact
- Maximum data recovery in all scenarios

See [DCT_EMBEDDING.md](DCT_EMBEDDING.md) for complete details.

---

## Troubleshooting

### Port Already in Use?

If port 3000 is busy, Vite will automatically try the next available port (3001, 3002, etc.). Check the terminal output for the actual URL.

### npm install fails?

- Make sure you have Node.js installed (v18+ recommended)
- Try deleting `node_modules` folder and `package-lock.json`, then run `npm install` again

### App doesn't load?

- Check the browser console for errors (F12)
- Make sure you're accessing the correct URL shown in the terminal
- Try clearing browser cache

---

## Building for Production

To create a production build:

```bash
npm run build
```

The built files will be in the `dist/` folder. You can serve them with any static file server.
