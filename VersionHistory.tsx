// components/VersionHistory.tsx
import React, { useRef, useState } from "react";

type Props = {
  session: any | null; // expects session.publicKeyPem optionally
};

const END_MARKER = "010001010100111001000100"; // "END" in binary — change if your system uses different marker

// helper: convert bit string -> bytes string
function bitsToByteString(bits: string) {
  const bytes: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    const byte = bits.slice(i, i + 8);
    if (byte.length === 8) bytes.push(parseInt(byte, 2));
  }
  return String.fromCharCode(...bytes);
}

// majority vote / triple redundancy decode
function majorityDecode(bits: string) {
  // expecting bits length multiple of 3; if not, we truncate remainder
  const groups = Math.floor(bits.length / 3);
  let out = "";
  for (let i = 0; i < groups; i++) {
    const g = bits.slice(i * 3, i * 3 + 3);
    const ones = (g[0] === "1") + (g[1] === "1") + (g[2] === "1");
    out += ones >= 2 ? "1" : "0";
  }
  return out;
}

async function sha256Hex(buffer: ArrayBuffer) {
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function verifySignatureWithPem(headerString: string, signatureB64: string, publicKeyPem: string, algorithm: "RSA-PSS" | "ECDSA" = "ECDSA") {
  // imports a PEM public key and verifies signature (assumes ECDSA P-256 / SHA-256 or RSA-PSS/SHA-256)
  const binaryDer = pemToArrayBuffer(publicKeyPem);
  let alg;
  if (algorithm === "ECDSA") {
    alg = { name: "ECDSA", namedCurve: "P-256" } as any;
  } else {
    alg = { name: "RSA-PSS", hash: "SHA-256" } as any;
  }

  const key = await crypto.subtle.importKey("spki", binaryDer, alg, false, ["verify"]);
  const signature = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
  const enc = new TextEncoder().encode(headerString);

  try {
    if (algorithm === "ECDSA") {
      // WebCrypto ECDSA signatures are DER-encoded. If you used raw r||s you must adapt.
      return await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, signature, enc);
    } else {
      return await crypto.subtle.verify({ name: "RSA-PSS", saltLength: 32 }, key, signature, enc);
    }
  } catch (e) {
    console.error("verify error", e);
    return false;
  }
}

function pemToArrayBuffer(pem: string) {
  // strips header/footer and base64 decodes
  const b64 = pem.replace(/-----(BEGIN|END)[\w\s]+-----/g, "").replace(/\s+/g, "");
  const binary = atob(b64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

export const VersionHistory: React.FC<Props> = ({ session }) => {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [payloadJson, setPayloadJson] = useState<any | null>(null);
  const [publicKey, setPublicKey] = useState<string>(session?.publicKeyPem ?? "");
  const [rawExtractText, setRawExtractText] = useState<string | null>(null);
  const [diagnostics, setDiagnostics] = useState<string | null>(null);

  const handleFile = async (file: File | null) => {
    setStatus(null);
    setPayloadJson(null);
    setRawExtractText(null);
    setDiagnostics(null);

    if (!file) return;
    const img = new Image();
    const objectURL = URL.createObjectURL(file);

    img.onload = async () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = img.width;
        canvas.height = img.height;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Cannot get canvas context");
        ctx.drawImage(img, 0, 0);
        const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = imageData.data; // [R,G,B,A,...]

        // --- STEP A: extract LSB bits (skip alpha)
        const bits: string[] = [];
        for (let i = 0; i < data.length; i++) {
          if ((i + 1) % 4 === 0) continue; // skip alpha
          bits.push((data[i] & 1).toString());
        }

        // locate END marker (naive)
        const bitString = bits.join("");
        const endIndex = bitString.indexOf(END_MARKER);
        if (endIndex === -1) {
          // maybe triple redundancy used: attempt majority decoding then search
          const maj = majorityDecode(bitString);
          const endIndexMaj = maj.indexOf(END_MARKER);
          if (endIndexMaj === -1) {
            // extraction failed
            setDiagnostics("LSB extraction failed: END marker not found. Attempted majority-decode as fallback.");
            // show some stats to help debug
            setStatus("Data corruption detected. Unable to extract version history.");
            setRawExtractText(null);
            URL.revokeObjectURL(objectURL);
            return;
          } else {
            // we have majority-decoded payload
            const payloadBits = maj.slice(0, endIndexMaj);
            const compressedString = bitsToByteString(payloadBits);
            setRawExtractText(compressedString);
            try {
              // assume compressed with DEFLATE -> but browser cannot inflate without pako. we'll just try to parse as JSON if not compressed
              const maybeJson = tryParsePossiblyCompressed(compressedString);
              if (maybeJson) {
                setPayloadJson(maybeJson);
                setStatus("Payload extracted (via majority decode).");
              } else {
                setStatus("Payload extracted (via majority decode), but decompression/JSON parsing failed.");
              }
            } catch (err) {
              setStatus("Payload extraction completed but decompression/parsing failed.");
            }
          }
        } else {
          // direct extraction succeeded
          const payloadBits = bitString.slice(0, endIndex);
          // Check if redundancy used: if (bitString.length >= payloadBits.length*3) maybe it's tripled;
          let recoveredBits = payloadBits;
          // Heuristic: if payload encoded as triple redundancy -> length divisible by 3 and larger than some threshold
          if (payloadBits.length % 3 === 0 && payloadBits.length > 300) {
            // Attempt majority decode on payloadBits
            recoveredBits = majorityDecode(payloadBits);
          }
          const compressedString = bitsToByteString(recoveredBits);
          setRawExtractText(compressedString);

          // Try parse (if compressed, need pako). If your project uses pako, call pako.inflate.
          const maybeJson = tryParsePossiblyCompressed(compressedString);
          if (maybeJson) {
            setPayloadJson(maybeJson);
            setStatus("Payload extracted successfully.");
          } else {
            setStatus("Payload extracted but decompression/JSON parse failed. (Maybe compressed — include pako)");
          }
        }
      } catch (err: any) {
        console.error(err);
        setStatus("Data corruption detected. Unable to extract version history.");
        setDiagnostics(String(err?.message ?? err));
      } finally {
        URL.revokeObjectURL(objectURL);
      }
    };

    img.onerror = () => {
      setStatus("Could not load image. Is the file a valid image?");
      URL.revokeObjectURL(objectURL);
    };

    img.src = objectURL;
  };

  // small helper: tries JSON parse; if fails returns null.
  function tryParsePossiblyCompressed(s: string) {
    try {
      // If your payload is compressed with pako.deflate -> s is binary string; here we can't inflate without pako.
      // If you have pako available in project, replace this with:
      // const bytes = Uint8Array.from(s.split('').map(c => c.charCodeAt(0)));
      // const decompressed = pako.inflate(bytes, { to: 'string' });
      // return JSON.parse(decompressed);
      return JSON.parse(s);
    } catch (e) {
      return null;
    }
  }

  // Signature verification UI
  const handleVerifySignatures = async () => {
    if (!payloadJson) return setStatus("No payload to verify.");
    if (!publicKey) return setStatus("Paste the public key in the box to verify signatures.");

    // sample verification: iterate payload.history and verify each signature if present
    try {
      const history = payloadJson.history ?? payloadJson?.payload?.history ?? null;
      if (!history || !Array.isArray(history)) {
        setStatus("No history array found in payload.");
        return;
      }
      // We'll verify just one sample entry header -> signature (you must adapt header recreation to your signing method)
      const results: Array<{ version: any; ok: boolean; reason?: string }> = [];
      for (const entry of history) {
        try {
          const header = JSON.stringify(entry, Object.keys(entry).sort().filter(k => k !== "signature"));
          const sig = entry.signature;
          if (!sig) {
            results.push({ version: entry.version ?? "? ", ok: false, reason: "no signature" });
            continue;
          }
          // attempt ECDSA verification
          const ok = await verifySignatureWithPem(header, sig, publicKey, "ECDSA");
          results.push({ version: entry.version ?? "?", ok, reason: ok ? undefined : "invalid signature" });
        } catch (err) {
          results.push({ version: entry.version ?? "?", ok: false, reason: "verify error" });
        }
      }
      const bad = results.filter(r => !r.ok);
      if (bad.length === 0) {
        setStatus("All signatures valid ✅");
      } else {
        setStatus(`Signatures verification: ${results.length - bad.length} valid, ${bad.length} invalid. See console for details.`);
        console.log("verify results", results);
      }
    } catch (err) {
      setStatus("Verification failed: " + String(err));
    }
  };

  return (
    <div className="p-4">
      <h2 className="text-xl font-semibold mb-4">Version History & Verification</h2>
      <div className="mb-4">
        <input
          type="file"
          accept="image/*"
          ref={fileRef}
          onChange={(e) => handleFile(e.target.files ? e.target.files[0] : null)}
          className="mb-2"
        />
      </div>

      <div className="mb-4">
        <button
          onClick={() => {
            // re-trigger with current file
            if (fileRef.current?.files?.[0]) handleFile(fileRef.current.files[0]);
          }}
          className="px-3 py-2 bg-blue-600 text-white rounded-md mr-2"
        >
          Try Extract
        </button>
        <button
          onClick={() => {
            // clear
            setStatus(null);
            setPayloadJson(null);
            setRawExtractText(null);
            setDiagnostics(null);
          }}
          className="px-3 py-2 bg-gray-600 text-white rounded-md"
        >
          Clear
        </button>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium">Paste public key (PEM) to verify signatures</label>
        <textarea
          rows={3}
          value={publicKey}
          onChange={(e) => setPublicKey(e.target.value)}
          className="w-full mt-1 p-2 bg-gray-800 text-gray-200 rounded-md"
        />
        <div className="mt-2">
          <button onClick={handleVerifySignatures} className="px-3 py-2 bg-green-600 text-white rounded-md">Verify Signatures</button>
        </div>
      </div>

      <div className="mb-4">
        <div className="p-3 bg-gray-800 rounded-md">
          <div className="text-sm"><strong>Status:</strong> {status ?? "Idle"}</div>
          {diagnostics && <div className="text-xs text-yellow-300 mt-2"><strong>Diagnostics:</strong> {diagnostics}</div>}
          {rawExtractText && <div className="text-xs mt-2"><strong>Raw extracted (preview):</strong> {rawExtractText.slice(0, 200)}{rawExtractText.length > 200 ? "..." : ""}</div>}
          {payloadJson && (
            <div className="mt-3">
              <strong>Payload JSON preview:</strong>
              <pre className="whitespace-pre-wrap text-xs mt-1 bg-gray-900 p-2 rounded-md max-h-48 overflow-auto">{JSON.stringify(payloadJson, null, 2)}</pre>
            </div>
          )}
        </div>
      </div>

      <div className="text-sm text-gray-400">
        <p><strong>Notes / Next steps</strong>:</p>
        <ul className="list-disc ml-5">
          <li>If extraction fails, it may be because you used compression (DEFLATE). Add <code>pako</code> and call <code>pako.inflate</code> on the binary bytes before JSON.parse.</li>
          <li>If LSB data is corrupted by edits or JPEG re-save, paste the <em>public key</em> and the last known image-hash (if available) to run tamper detection.</li>
          <li>Ensure <code>ImageWorkflow</code> stores <code>session.publicKeyPem</code> when generating keys.</li>
        </ul>
      </div>
    </div>
  );
};

export default VersionHistory;
