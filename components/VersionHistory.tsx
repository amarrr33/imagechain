import React, { useMemo, useState } from 'react';
import {
  renderCanvasFromImage,
  canvasToBlob,
} from '../services/imageService';
import {
  extractPayloadWithDetails,
} from '../services/watermarkService';
import { tryExtractWithRotations } from '../services/extractionService';
import {
  verifySignature,
  getPayloadHeader,
  sha256,
} from '../services/cryptoService';
import type {
  SessionData,
  VersionInfo,
  VerificationResult,
  ChainedPayload,
  HistoryEntry,
} from '../types';
import {
  UploadIcon,
  SparklesIcon,
  Spinner,
  CheckCircleIcon,
  XCircleIcon,
  InformationCircleIcon,
  DownloadIcon,
} from './Icons';

interface VersionHistoryProps {
  session: SessionData | null;
}

interface ExtractionSummary {
  rotation?: number;
  metadataNotice?: string;
}

const canvasFromDataUrl = async (dataUrl: string): Promise<HTMLCanvasElement> => {
  const img = new Image();
  await new Promise<void>((resolve, reject) => {
    img.onload = () => resolve();
    img.onerror = () => reject(new Error('Failed to load session image.'));
    img.src = dataUrl;
  });
  const { canvas } = await renderCanvasFromImage(img);
  return canvas;
};

const runVerification = async (
  payload: ChainedPayload,
  publicKeyPem: string,
  currentCanvas?: HTMLCanvasElement,
  isUploadedImage = false,
): Promise<{ results: VersionInfo[]; hashMismatch?: boolean }> => {
  const results: VersionInfo[] = [];
  let previousHash: string | null = null;
  let hashMismatch = false;

  let currentHash: string | undefined;
  if (currentCanvas) {
    const blob = await canvasToBlob(currentCanvas);
    currentHash = await sha256(await blob.arrayBuffer());
  }

  for (const entry of payload.history) {
    const verification: VerificationResult = {
      isSignatureValid: false,
      isChainLinkValid: false,
    };

    const header = getPayloadHeader(entry);
    verification.isSignatureValid = await verifySignature(
      header,
      entry.signature,
      publicKeyPem,
      entry.sig_scheme,
    );

    verification.isChainLinkValid = entry.parent_hash === previousHash;

    // Only check hash mismatch for the last version, and only if:
    // 1. We have a current hash to compare
    // 2. This is NOT an uploaded image (uploaded images have watermarks embedded, so hash will differ)
    //    OR if it is uploaded, we should compare against the expected watermarked hash
    if (currentHash && entry === payload.history[payload.history.length - 1]) {
      // For uploaded images, the hash stored is pre-watermark, but the uploaded image has watermark
      // So we expect a mismatch. Only show error if signatures/chain are invalid.
      // For active session verification, we can check hash mismatch.
      if (!isUploadedImage && entry.sha256 !== currentHash) {
        hashMismatch = true;
        verification.error = 'Image hash does not match committed version.';
      }
      // For uploaded images, hash mismatch is expected (watermark changes hash)
      // So we don't flag it as an error unless other verification fails
    }

    if (!verification.isSignatureValid) {
      verification.error = (verification.error ?? '') + ' Signature invalid.';
    }
    if (!verification.isChainLinkValid) {
      verification.error = (verification.error ?? '') + ' Hash chain broken.';
    }

    results.push({ entry, verification });
    previousHash = entry.sha256;
  }

  return { results, hashMismatch };
};

export const VersionHistory: React.FC<VersionHistoryProps> = ({ session }) => {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [publicKeyPem, setPublicKeyPem] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [extractedPayload, setExtractedPayload] = useState<ChainedPayload | null>(null);
  const [verificationResults, setVerificationResults] = useState<VersionInfo[]>([]);
  const [extractionSummary, setExtractionSummary] = useState<ExtractionSummary | null>(null);

  const sessionPublicKey = useMemo(() => session?.keys.publicKeyPem ?? '', [session]);

  const handleExtractHistory = async () => {
    if (!selectedFile) {
      setError('Please select an ImageChain file first.');
      return;
    }

    setIsLoading(true);
    setError(null);
    setInfo(null);
    setVerificationResults([]);

    try {
      const attempt = await tryExtractWithRotations(selectedFile);
      if (attempt.success && attempt.payload) {
        setExtractedPayload(attempt.payload);
        setExtractionSummary({
          rotation: attempt.rotation,
        });
        const versionCount = attempt.payload.history.length;
        setInfo(
          `History extracted successfully${
            attempt.rotation ? ` after rotating ${attempt.rotation}°` : ''
          }. Found ${versionCount} version${versionCount !== 1 ? 's' : ''}.`,
        );
      } else if (attempt.criticalMetadata) {
        // Even if we only have critical metadata, we can show what we know
        const meta = attempt.criticalMetadata;
        setExtractedPayload({
          chain_id: meta.chain_id,
          history: [],
          _dct_metadata: {
            chain_id: meta.chain_id,
            version_count: meta.version_count,
            last_version_hash: meta.last_version_hash,
          },
        });
        setExtractionSummary({
          rotation: attempt.rotation,
          metadataNotice: `Only critical metadata recovered (${meta.version_count} versions detected, but full history lost - likely due to JPEG recompression). Use a lossless PNG to recover complete history.`,
        });
        setInfo(`Partial recovery: Found metadata for ${meta.version_count} version(s) but full history is unavailable.`);
      } else {
        setExtractedPayload(null);
        setError(attempt.error || 'Unable to recover history from this file. This image may not contain ImageChain data, or the watermark may have been corrupted.');
      }
    } catch (ex) {
      console.error('Extraction failed', ex);
      setError('An unexpected error occurred while extracting history.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifyExtracted = async () => {
    if (!extractedPayload) {
      setError('Extract history before running verification.');
      return;
    }
    if (!publicKeyPem.trim()) {
      setError('Paste the signer public key to verify signatures.');
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      // For uploaded images, pass isUploadedImage=true to skip hash mismatch check
      // (since uploaded images have watermarks embedded, hash will differ from stored pre-watermark hash)
      const { results } = await runVerification(extractedPayload, publicKeyPem, undefined, true);
      setVerificationResults(results);
    } catch (ex) {
      console.error('Verification failed', ex);
      setError('Verification failed. Ensure the public key matches the signer.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleVerifySession = async () => {
    if (!session) return;
    setIsLoading(true);
    setError(null);
    setVerificationResults([]);
    try {
      const canvas = await canvasFromDataUrl(session.currentImageSrc);
      const { results, hashMismatch } = await runVerification(
        session.payload,
        sessionPublicKey || publicKeyPem || session.keys.publicKeyPem,
        canvas,
      );
      if (hashMismatch) {
        setInfo('The working canvas differs from the last committed version.');
      }
      setVerificationResults(results);
    } catch (ex) {
      console.error('Session verification failed', ex);
      setError('Unable to verify the active session.');
    } finally {
      setIsLoading(false);
    }
  };

  const renderVersionCard = (version: VersionInfo) => {
    const valid = version.verification.isSignatureValid && version.verification.isChainLinkValid;
    return (
      <div
        className={`space-y-4 rounded-xl border p-5 ${
          valid
            ? 'border-green-500/40 bg-green-500/10'
            : 'border-red-500/40 bg-red-500/10'
        }`}
      >
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex-1">
            <h4 className="text-xl font-bold text-white">
              Version {version.entry.version}
              {version.entry.version === 1 && (
                <span className="ml-2 text-xs font-semibold uppercase bg-blue-500/50 text-blue-200 px-2 py-1 rounded-full">Original</span>
              )}
            </h4>
            <p className="text-sm text-gray-300 mt-1">
              Signed by <span className="font-semibold text-green-400">{version.entry.signer}</span> on{' '}
              {new Date(version.entry.timestamp).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500 mt-1 font-mono">
              Hash: {version.entry.sha256.substring(0, 16)}...
            </p>
          </div>
          <div
            className={`flex items-center rounded-full px-4 py-2 text-sm font-semibold ${
              valid ? 'bg-green-500/20 text-green-200' : 'bg-red-500/20 text-red-200'
            }`}
          >
            {valid ? <CheckCircleIcon className="mr-2" /> : <XCircleIcon className="mr-2" />}
            {valid ? 'Verified' : 'Failed'}
          </div>
        </div>
        {version.verification.error && (
          <p className="rounded-md border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-100">
            {version.verification.error.trim()}
          </p>
        )}
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="space-y-2 rounded-md border border-gray-800 bg-gray-900/60 p-4 text-xs text-gray-300">
            <h5 className="font-semibold text-gray-200 mb-2">Edit Log</h5>
            {version.entry.edit_log.length ? (
              <ul className="space-y-1 max-h-32 overflow-y-auto">
                {version.entry.edit_log.map((op, idx) => (
                  <li key={idx} className="font-mono text-gray-400 text-xs">
                    {JSON.stringify(op, null, 2)}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-gray-500 italic">
                {version.entry.version === 1 
                  ? 'Original image - no edits applied yet. This is the root image of the chain.'
                  : 'No edits recorded for this version.'}
              </p>
            )}
          </div>
          <div className="space-y-2 rounded-md border border-gray-800 bg-gray-900/60 p-4 text-xs text-gray-300">
            <h5 className="font-semibold text-gray-200 mb-2">Snapshot</h5>
            {version.entry.snapshot ? (
              <img
                src={`data:image/${version.entry.snapshot.codec};base64,${version.entry.snapshot.bytes_b64}`}
                alt={`Snapshot v${version.entry.version}`}
                className="rounded border border-gray-800 max-w-full h-32 object-contain"
              />
            ) : (
              <div className="h-32 rounded border border-gray-800 bg-gray-800 flex items-center justify-center">
                <p className="text-gray-500 italic text-xs">No snapshot captured.</p>
              </div>
            )}
          </div>
          <div className="space-y-2 rounded-md border border-gray-800 bg-gray-900/60 p-4 text-xs text-gray-300">
            <h5 className="font-semibold text-gray-200 mb-2">Payload Data</h5>
            <div className="max-h-48 overflow-y-auto font-mono text-xs bg-gray-950/50 p-2 rounded">
              <pre className="whitespace-pre-wrap break-words text-gray-400">
                {JSON.stringify({
                  version: version.entry.version,
                  sha256: version.entry.sha256,
                  parent_hash: version.entry.parent_hash,
                  timestamp: version.entry.timestamp,
                  signer: version.entry.signer,
                  sig_scheme: version.entry.sig_scheme,
                  edit_count: version.entry.edit_log.length,
                  has_snapshot: !!version.entry.snapshot,
                }, null, 2)}
              </pre>
            </div>
          </div>
          <div className="flex justify-end pt-2 border-t border-gray-700">
            <button
              onClick={async () => {
                try {
                  // If this version has a snapshot, download it (especially important for version 1 - the original image)
                  if (version.entry.snapshot) {
                    const base64Data = version.entry.snapshot.bytes_b64;
                    const mimeType = `image/${version.entry.snapshot.codec}`;
                    const byteCharacters = atob(base64Data);
                    const byteNumbers = new Array(byteCharacters.length);
                    for (let i = 0; i < byteCharacters.length; i++) {
                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                    }
                    const byteArray = new Uint8Array(byteNumbers);
                    const blob = new Blob([byteArray], { type: mimeType });
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `imagechain_v${version.entry.version}_${version.entry.version === 1 ? 'original' : 'snapshot'}_verified_${new Date(version.entry.timestamp).toISOString().split('T')[0]}.${version.entry.snapshot.codec}`;
                    link.click();
                    URL.revokeObjectURL(link.href);
                  } else if (selectedFile) {
                    // Fallback: download the current extracted image if no snapshot
                    const img = await renderCanvasFromImage(selectedFile);
                    const canvas = img.canvas;
                    const blob = await canvasToBlob(canvas);
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `imagechain_v${version.entry.version}_verified_${new Date(version.entry.timestamp).toISOString().split('T')[0]}.png`;
                    link.click();
                    URL.revokeObjectURL(link.href);
                  } else {
                    alert('Unable to download this version. No snapshot available and no source image.');
                  }
                } catch (err) {
                  console.error('Download failed', err);
                  alert('Unable to download this version.');
                }
              }}
              className="text-sm bg-blue-600 hover:bg-blue-500 text-white px-4 py-2 rounded transition"
            >
              {version.entry.snapshot ? (version.entry.version === 1 ? 'Download Original Image' : 'Download Snapshot') : `Download Version ${version.entry.version}`}
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-8 max-w-7xl mx-auto">
      <header className="space-y-3">
        <h2 className="text-3xl font-bold text-white">ImageChain History & Verification</h2>
        <p className="text-gray-400 text-lg">
          Extract the embedded history from any ImageChain image, verify each signature, and inspect
          snapshots without leaving your browser.
        </p>
      </header>

      {session && (
        <section className="space-y-3 rounded-xl border border-blue-500/40 bg-blue-500/10 p-6">
          <h3 className="text-lg font-semibold text-white">Active Session</h3>
          <p className="text-sm text-blue-200">
            Verify the image you are currently editing using the session public key.
          </p>
          <div className="flex flex-wrap gap-3">
            <button
              onClick={handleVerifySession}
              disabled={isLoading}
              className="flex items-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:bg-blue-900"
            >
              {isLoading ? <Spinner className="mr-2" /> : <SparklesIcon className="mr-2" />}
              Verify Current Session
            </button>
            <button
              onClick={() => setPublicKeyPem(sessionPublicKey)}
              className="rounded-lg border border-blue-400/40 bg-transparent px-4 py-2 text-sm font-semibold text-blue-100 transition hover:bg-blue-500/20"
            >
              Use Session Public Key
            </button>
          </div>
        </section>
      )}

      <section className="space-y-6 rounded-xl border border-gray-800 bg-gray-900/70 p-8 shadow-inner">
        <h3 className="text-xl font-semibold text-white">Verify An ImageChain File</h3>
        <div className="grid gap-6 lg:grid-cols-2">
          <label className="flex h-36 cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-gray-700 bg-gray-900/60 text-center transition hover:border-blue-500/40 hover:bg-blue-500/10">
            <UploadIcon className="h-10 w-10 text-blue-400" />
            <span className="mt-2 text-sm font-semibold text-gray-200">
              Drop ImageChain file or click to browse
            </span>
            <input
              type="file"
              accept="image/png,image/jpeg,image/jpg"
              onChange={(event) => setSelectedFile(event.target.files?.[0] ?? null)}
              className="hidden"
            />
            {selectedFile && (
              <span className="mt-2 text-xs text-gray-400">{selectedFile.name}</span>
            )}
          </label>
          <div className="flex flex-col space-y-2">
            <label className="text-sm font-semibold text-gray-300">
              Public Key (PEM)
              <textarea
                value={publicKeyPem}
                onChange={(event) => setPublicKeyPem(event.target.value)}
                rows={6}
                placeholder="Optional: paste the signer public key to verify signatures…"
                className="mt-2 h-32 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 font-mono text-xs text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </label>
          </div>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <button
            onClick={handleExtractHistory}
            disabled={isLoading || !selectedFile}
            className="flex items-center justify-center rounded-lg bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-blue-900"
          >
            {isLoading ? <Spinner className="mr-2" /> : <SparklesIcon className="mr-2" />}
            Extract History
          </button>
          <button
            onClick={handleVerifyExtracted}
            disabled={isLoading || !extractedPayload || !publicKeyPem.trim()}
            className="flex items-center justify-center rounded-lg border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 transition hover:border-blue-500 hover:text-white disabled:cursor-not-allowed disabled:text-gray-600"
          >
            Verify Signatures
          </button>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-100">
          {error}
        </div>
      )}

      {info && (
        <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-sm text-blue-100">
          {info}
        </div>
      )}

      {extractionSummary?.metadataNotice && (
        <div className="rounded-xl border border-yellow-500/40 bg-yellow-500/10 p-4 text-sm text-yellow-100">
          <strong>Partial recovery:</strong> {extractionSummary.metadataNotice}
        </div>
      )}

      {extractedPayload && (
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
            <h3 className="text-lg font-semibold text-white mb-3">History Overview</h3>
            <div className="grid gap-3 md:grid-cols-2">
              <div>
                <p className="text-sm text-gray-400">Chain ID:</p>
                <p className="font-mono text-gray-200 text-xs break-all">
                  {extractedPayload.chain_id}
                </p>
              </div>
              <div>
                <p className="text-sm text-gray-400">Versions Found:</p>
                <p className="text-lg font-bold text-white">
                  {extractedPayload.history.length}
                </p>
              </div>
            </div>
            {extractionSummary?.rotation !== undefined && (
              <p className="text-xs text-gray-500 mt-2">
                Extracted using rotation correction of {extractionSummary.rotation}°.
              </p>
            )}
            {extractedPayload.history.length === 0 && extractedPayload._dct_metadata && (
              <div className="mt-3 rounded-md border border-yellow-500/30 bg-yellow-500/10 p-3">
                <p className="text-sm text-yellow-100">
                  <strong>Metadata Only:</strong> Found evidence of {extractedPayload._dct_metadata.version_count} version(s) but full history is unavailable.
                </p>
              </div>
            )}
          </div>
          {extractedPayload.history.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-5">
              <h3 className="text-lg font-semibold text-white mb-3">Version List (No Verification)</h3>
              <p className="text-sm text-gray-400 mb-4">
                These versions were extracted from the image. To verify signatures, provide the public key above.
              </p>
              <div className="space-y-4">
                {/* Visual timeline going back from most recent to initial */}
                <div className="relative">
                  <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-blue-500 via-blue-400 to-green-500"></div>
                  {[...extractedPayload.history].reverse().map((entry, idx) => (
                    <div key={entry.version} className="relative flex items-start gap-4 pb-6 last:pb-0">
                      <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-blue-500 bg-gray-900">
                        <span className="text-xs font-bold text-white">{entry.version}</span>
                      </div>
                      <div className="flex-1 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
                        <div className="grid gap-4 md:grid-cols-[auto_1fr_auto] items-start">
                          {/* Snapshot thumbnail */}
                          <div className="flex-shrink-0">
                            {entry.snapshot ? (
                              <img
                                src={`data:image/${entry.snapshot.codec};base64,${entry.snapshot.bytes_b64}`}
                                alt={`Version ${entry.version}`}
                                className="h-20 w-20 rounded border-2 border-gray-700 object-cover"
                              />
                            ) : (
                              <div className="h-20 w-20 rounded border-2 border-gray-700 bg-gray-800 flex items-center justify-center">
                                <span className="text-xs text-gray-500">No snapshot</span>
                              </div>
                            )}
                          </div>
                          {/* Version info */}
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-semibold text-white">Version {entry.version}</span>
                              {entry.version === 1 && (
                                <span className="text-xs font-semibold uppercase bg-blue-500/50 text-blue-200 px-2 py-1 rounded-full">Original</span>
                              )}
                              {entry.version === extractedPayload.history.length && (
                                <span className="text-xs font-semibold uppercase bg-green-500/50 text-green-200 px-2 py-1 rounded-full">Latest</span>
                              )}
                            </div>
                            <p className="text-xs text-gray-400">
                              by <span className="font-semibold text-green-400">{entry.signer}</span> · {new Date(entry.timestamp).toLocaleString()}
                            </p>
                            {entry.edit_log.length > 0 ? (
                              <p className="text-xs text-gray-400 mt-1">
                                {entry.edit_log.length} edit{entry.edit_log.length !== 1 ? 's' : ''} recorded
                              </p>
                            ) : entry.version === 1 ? (
                              <p className="text-xs text-gray-400 mt-1 italic">
                                Original root image - no edits applied
                              </p>
                            ) : null}
                            <p className="text-xs text-gray-500 mt-1 font-mono">
                              Hash: {entry.sha256.substring(0, 12)}...
                            </p>
                          </div>
                          {/* Actions */}
                          <div className="flex flex-col items-end gap-2">
                            <span className="text-xs bg-yellow-500/20 text-yellow-200 px-3 py-1 rounded">
                              Not Verified
                            </span>
                            <button
                              onClick={async () => {
                                try {
                                  // If this version has a snapshot, download it (especially important for version 1 - the original image)
                                  if (entry.snapshot) {
                                    const base64Data = entry.snapshot.bytes_b64;
                                    const mimeType = `image/${entry.snapshot.codec}`;
                                    const byteCharacters = atob(base64Data);
                                    const byteNumbers = new Array(byteCharacters.length);
                                    for (let i = 0; i < byteCharacters.length; i++) {
                                      byteNumbers[i] = byteCharacters.charCodeAt(i);
                                    }
                                    const byteArray = new Uint8Array(byteNumbers);
                                    const blob = new Blob([byteArray], { type: mimeType });
                                    const link = document.createElement('a');
                                    link.href = URL.createObjectURL(blob);
                                    link.download = `imagechain_v${entry.version}_${entry.version === 1 ? 'original' : 'snapshot'}_${new Date(entry.timestamp).toISOString().split('T')[0]}.${entry.snapshot.codec}`;
                                    link.click();
                                    URL.revokeObjectURL(link.href);
                                  } else if (selectedFile) {
                                    // Fallback: download the current extracted image if no snapshot
                                    const img = await renderCanvasFromImage(selectedFile);
                                    const canvas = img.canvas;
                                    const blob = await canvasToBlob(canvas);
                                    const link = document.createElement('a');
                                    link.href = URL.createObjectURL(blob);
                                    link.download = `imagechain_v${entry.version}_${new Date(entry.timestamp).toISOString().split('T')[0]}.png`;
                                    link.click();
                                    URL.revokeObjectURL(link.href);
                                  } else {
                                    alert('Unable to download this version. No snapshot available and no source image.');
                                  }
                                } catch (err) {
                                  console.error('Download failed', err);
                                  alert('Unable to download this version. The image may need to be reconstructed from edit history.');
                                }
                              }}
                              className="text-xs bg-blue-600 hover:bg-blue-500 text-white px-3 py-1 rounded transition"
                            >
                              {entry.snapshot ? (entry.version === 1 ? 'Download Original' : 'Download Snapshot') : 'Download'}
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </section>
      )}

      {verificationResults.length > 0 && (
        <section className="space-y-4">
          <h3 className="text-xl font-semibold text-white">Verification Results</h3>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gradient-to-b from-green-500 via-green-400 to-blue-500"></div>
            <div className="space-y-4">
              {[...verificationResults].reverse().map((version, idx) => (
                <div key={version.entry.version} className="relative flex items-start gap-4">
                  <div className="relative z-10 flex h-8 w-8 items-center justify-center rounded-full border-2 border-green-500 bg-gray-900">
                    {version.verification.isSignatureValid && version.verification.isChainLinkValid ? (
                      <CheckCircleIcon className="h-5 w-5 text-green-400" />
                    ) : (
                      <XCircleIcon className="h-5 w-5 text-red-400" />
                    )}
                  </div>
                  <div className="flex-1">{renderVersionCard(version)}</div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {extractedPayload && verificationResults.length === 0 && (
        <section className="space-y-3 rounded-xl border border-gray-800 bg-gray-900/70 p-4 text-sm text-gray-300">
          <div className="flex items-center">
            <InformationCircleIcon className="mr-2 text-blue-300" />
            <span>
              History extracted. Paste the signer public key and click{' '}
              <strong>Verify Signatures</strong> to authenticate each version.
            </span>
          </div>
        </section>
      )}
    </div>
  );
};

export default VersionHistory;

