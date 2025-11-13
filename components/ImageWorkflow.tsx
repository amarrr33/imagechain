import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  renderCanvasFromImage,
  createSnapshot,
  canvasToBlob,
} from '../services/imageService';
import {
  generateKeyPair,
  signPayload,
  getPayloadHeader,
  sha256,
  exportPublicKeyToPem,
} from '../services/cryptoService';
import {
  embedPayload,
  extractPayloadWithDetails,
} from '../services/watermarkService';
import { downloadTextFile } from '../services/downloadService';
import type {
  SessionData,
  PreSessionState,
  FilterType,
  EditOperation,
  ChainedPayload,
  HistoryEntry,
} from '../types';
import { SigScheme } from '../types';
import {
  Spinner,
  UploadIcon,
  SparklesIcon,
  KeyIcon,
  DownloadIcon,
  ListBulletIcon,
} from './Icons';

type PreSessionStep = 'keys' | 'upload';

interface ImageWorkflowProps {
  session: SessionData | null;
  onSessionUpdate: (session: SessionData | null) => void;
  preSessionState: PreSessionState;
  onPreSessionStateChange: (newState: PreSessionState) => void;
}

interface TextOverlayState {
  text: string;
  x: number;
  y: number;
  color: string;
  size: number;
}

const DEFAULT_TEXT_OVERLAY: TextOverlayState = {
  text: '',
  x: 50,
  y: 50,
  color: '#ffffff',
  size: 48,
};

const FILTER_OPTIONS: FilterType[] = ['none', 'grayscale', 'sepia', 'invert'];

export const ImageWorkflow: React.FC<ImageWorkflowProps> = ({
  session,
  onSessionUpdate,
  preSessionState,
  onPreSessionStateChange,
}) => {
  const [preSessionStep, setPreSessionStep] = useState<PreSessionStep>('keys');
  const [isLoading, setIsLoading] = useState(false);
  const [loadingText, setLoadingText] = useState('');

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const baseImageRef = useRef<HTMLImageElement | null>(null);

  const [brightness, setBrightness] = useState(100);
  const [contrast, setContrast] = useState(100);
  const [rotation, setRotation] = useState(0);
  const [filter, setFilter] = useState<FilterType>('none');
  const [textOverlay, setTextOverlay] = useState<TextOverlayState>(DEFAULT_TEXT_OVERLAY);
  const [editLog, setEditLog] = useState<EditOperation[]>([]);

  const { signerInput, sigScheme } = preSessionState;

  const setSignerInput = (value: string) =>
    onPreSessionStateChange({ ...preSessionState, signerInput: value });
  const setSigScheme = (value: SigScheme) =>
    onPreSessionStateChange({ ...preSessionState, sigScheme: value });

  const resetEdits = useCallback(() => {
    setBrightness(100);
    setContrast(100);
    setRotation(0);
    setFilter('none');
    setTextOverlay(DEFAULT_TEXT_OVERLAY);
    setEditLog([]);
  }, []);

  const applyEdits = useCallback(() => {
    const baseImage = baseImageRef.current;
    const canvas = canvasRef.current;
    if (!baseImage || !canvas) return;

    const width = baseImage.naturalWidth || baseImage.width;
    const height = baseImage.naturalHeight || baseImage.height;
    const radians = (rotation * Math.PI) / 180;
    const sin = Math.abs(Math.sin(radians));
    const cos = Math.abs(Math.cos(radians));
    const rotatedWidth = Math.max(1, Math.round(width * cos + height * sin));
    const rotatedHeight = Math.max(1, Math.round(width * sin + height * cos));

    canvas.width = rotatedWidth;
    canvas.height = rotatedHeight;
    const ctx = canvas.getContext('2d', { 
      willReadFrequently: true,
      // Disable smoothing when rotating to preserve LSB bits for watermarking
      imageSmoothingEnabled: rotation === 0,
      imageSmoothingQuality: rotation === 0 ? 'high' : 'low'
    });
    if (!ctx) return;

    let filterString = `brightness(${brightness}%) contrast(${contrast}%)`;
    if (filter === 'grayscale') filterString += ' grayscale(100%)';
    if (filter === 'sepia') filterString += ' sepia(100%)';
    if (filter === 'invert') filterString += ' invert(100%)';

    ctx.clearRect(0, 0, rotatedWidth, rotatedHeight);
    ctx.save();
    ctx.filter = filterString;
    ctx.translate(rotatedWidth / 2, rotatedHeight / 2);
    ctx.rotate(radians);
    ctx.drawImage(baseImage, -width / 2, -height / 2);
    ctx.restore();

    if (textOverlay.text.trim()) {
      ctx.save();
      ctx.filter = 'none';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${textOverlay.size}px "Inter", system-ui, sans-serif`;
      ctx.fillStyle = textOverlay.color;
      ctx.fillText(
        textOverlay.text,
        (canvas.width * textOverlay.x) / 100,
        (canvas.height * textOverlay.y) / 100,
      );
      ctx.restore();
    }
  }, [brightness, contrast, rotation, filter, textOverlay]);

  useEffect(() => {
    applyEdits();
  }, [applyEdits]);

  const loadImageIntoCanvas = useCallback(
    async (dataUrl: string) =>
      new Promise<void>((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
          baseImageRef.current = img;
          applyEdits();
          resolve();
        };
        img.onerror = reject;
        img.src = dataUrl;
      }),
    [applyEdits],
  );

  useEffect(() => {
    if (session?.currentImageSrc) {
      loadImageIntoCanvas(session.currentImageSrc).catch((error) =>
        console.error('Failed to reload session image', error),
      );
    }
  }, [session?.currentImageSrc, loadImageIntoCanvas]);

  useEffect(() => {
    if (!session) {
      setPreSessionStep('keys');
      resetEdits();
    }
  }, [session, resetEdits]);

  const recordEdit = (operation: EditOperation) => {
    setEditLog((previous) => [...previous, operation]);
  };

  const handleContinueToUpload = () => {
    if (!signerInput.trim()) {
      alert('Please enter a signer name to continue.');
      return;
    }
    setPreSessionStep('upload');
  };

  const handleFileChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setLoadingText('Preparing session…');

    try {
      setLoadingText('Generating keys…');
      const keyPair = await generateKeyPair(sigScheme);

      setLoadingText('Normalising image…');
      const renderResult = await renderCanvasFromImage(file);
      const baseDataUrl = renderResult.canvas.toDataURL('image/png');
      await loadImageIntoCanvas(baseDataUrl);

      setLoadingText('Scanning for existing history…');
      const extraction = await extractPayloadWithDetails(renderResult.canvas);

      let payload: ChainedPayload;
      if (extraction.payload) {
        payload = extraction.payload;
        alert(
          `Existing ImageChain detected. Continuing from version ${payload.history.length}.`,
        );
      } else {
        const chainId = await renderResult.hashPromise;
        payload = { chain_id: chainId, history: [] };
      }

      const baseFileName = file.name.replace(/\.[^.]+$/, '');
      resetEdits();

      onSessionUpdate({
        signer: signerInput,
        payload,
        baseFileName,
        keys: {
          privateKeyPem: keyPair.privateKeyPem,
          publicKeyPem: keyPair.publicKeyPem,
          privateKey: keyPair.privateKey,
          publicKey: keyPair.publicKey,
        } as any,
        currentImageSrc: baseDataUrl,
      });

      setPreSessionStep('upload');
    } catch (error) {
      console.error('Session initialisation failed', error);
      alert('Unable to initialise ImageChain session for this file.');
    } finally {
      setIsLoading(false);
      setLoadingText('');
    }
  };

  const handleCommit = async () => {
    if (!session) return;
    const canvas = canvasRef.current;
    if (!canvas) {
      alert('Canvas not ready yet.');
      return;
    }
    // Allow committing even without edits (for initial version)
    const isInitialVersion = session.payload.history.length === 0;
    if (!isInitialVersion && editLog.length === 0) {
      alert('No edits to commit. Make a change first, or this will create a duplicate version.');
      return;
    }

    setIsLoading(true);
    setLoadingText('Creating version…');

    try {
      const blob = await canvasToBlob(canvas);
      const buffer = await blob.arrayBuffer();
      const currentHash = await sha256(buffer);
      const history = session.payload.history;
      const lastEntry = history.length ? history[history.length - 1] : undefined;
      const isInitialVersion = history.length === 0;
      
      // Always create snapshot for version 1 (original image) to preserve the root image
      // Also create snapshot if there are edits (to show what changed)
      const snapshot = (isInitialVersion || editLog.length > 0) ? await createSnapshot(canvas) : null;

      const newEntry: Omit<HistoryEntry, 'signature'> = {
        version: (lastEntry?.version ?? 0) + 1,
        sha256: currentHash,
        parent_hash: lastEntry?.sha256 ?? null,
        timestamp: new Date().toISOString(),
        signer: session.signer,
        sig_scheme: preSessionState.sigScheme,
        edit_log: editLog.length > 0 ? editLog : [],
        snapshot,
      };

      setLoadingText('Signing version…');
      const header = getPayloadHeader(newEntry);
      const signature = await signPayload(header, session.keys.privateKeyPem, sigScheme);

      const historyEntry: HistoryEntry = { ...newEntry, signature };
      const updatedPayload: ChainedPayload = {
        chain_id: session.payload.chain_id,
        history: [...session.payload.history, historyEntry],
      };

      setLoadingText('Embedding watermark…');
      embedPayload(canvas, updatedPayload);

      const updatedDataUrl = canvas.toDataURL('image/png');
      await loadImageIntoCanvas(updatedDataUrl);

      onSessionUpdate({
        ...session,
        payload: updatedPayload,
        currentImageSrc: updatedDataUrl,
      });

      resetEdits();
    } catch (error) {
      console.error('Commit failed', error);
      alert('Failed to commit version. See console for details.');
    } finally {
      setIsLoading(false);
      setLoadingText('');
    }
  };

  const handleDownload = async () => {
    if (!session) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const blob = await canvasToBlob(canvas);
    const link = document.createElement('a');
    const version = session.payload.history.length;
    link.href = URL.createObjectURL(blob);
    link.download = `${session.baseFileName || 'imagechain'}_v${version}.png`;
    link.click();
    URL.revokeObjectURL(link.href);
  };

  const handleDownloadPublicKey = async () => {
    if (!session) return;
    try {
      if ((session.keys as any).publicKey) {
        const pem = await exportPublicKeyToPem((session.keys as any).publicKey);
        downloadTextFile('imagechain_public_key.pem', pem);
      } else {
        downloadTextFile('imagechain_public_key.pem', session.keys.publicKeyPem);
      }
    } catch (error) {
      console.error('Public key export failed', error);
      alert('Unable to export public key.');
    }
  };

  const renderSignerStep = () => (
    <section className="mx-auto space-y-6 rounded-xl bg-gray-900/60 p-8 shadow-lg ring-1 ring-gray-800/80 max-w-2xl">
      <header className="text-center space-y-2">
        <h2 className="text-2xl font-bold text-white">Step 1 · Prepare Signer</h2>
        <p className="text-gray-400">
          Set the signer name and choose the signature scheme used to authenticate each version.
        </p>
      </header>
      <div className="space-y-4 rounded-xl border border-gray-800 bg-gray-900/70 p-6">
        <label className="block text-sm font-semibold text-gray-300">
          Signer Name
          <input
            type="text"
            placeholder="e.g. Studio Authenticator"
            value={signerInput}
            onChange={(event) => setSignerInput(event.target.value)}
            className="mt-2 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </label>
        <label className="block text-sm font-semibold text-gray-300">
          Signature Scheme
          <select
            value={sigScheme}
            onChange={(event) => setSigScheme(event.target.value as SigScheme)}
            className="mt-2 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value={SigScheme.RSA}>RSA-PSS · 3072-bit</option>
            <option value={SigScheme.ECC}>ECC · P-256</option>
          </select>
        </label>
      </div>
      <button
        onClick={handleContinueToUpload}
        className="flex w-full items-center justify-center rounded-lg bg-blue-600 py-3 font-semibold text-white transition hover:bg-blue-500 disabled:bg-gray-600"
        disabled={!signerInput.trim()}
      >
        <KeyIcon className="mr-2" /> Continue
      </button>
    </section>
  );

  const renderUploadStep = () => (
    <section className="mx-auto space-y-6 rounded-xl bg-gray-900/60 p-8 shadow-lg ring-1 ring-gray-800/80 max-w-2xl">
      <header className="text-center space-y-1">
        <h2 className="text-2xl font-bold text-white">Step 2 · Upload Image</h2>
        <p className="text-gray-400">
          ImageChain works entirely offline. We only read pixels to embed history.
        </p>
      </header>
      <div className="rounded-xl border border-dashed border-gray-700 bg-gray-900/60 p-8 text-center">
        <label className="flex cursor-pointer flex-col items-center justify-center space-y-4">
          <UploadIcon className="h-12 w-12 text-blue-400" />
          <span className="text-lg font-semibold text-white">
            Drop PNG or JPEG here, or click to browse
          </span>
          <input
            type="file"
            accept="image/png,image/jpeg,image/jpg"
            onChange={handleFileChange}
            className="hidden"
          />
          <p className="text-sm text-gray-400">
            Keys are generated automatically during the first upload.
          </p>
        </label>
      </div>
      <button
        onClick={() => setPreSessionStep('keys')}
        className="w-full text-sm text-gray-400 hover:text-white"
      >
        ← Back to signer configuration
      </button>
    </section>
  );

  const renderEditor = () => {
    if (!session) return null;
    const history = session.payload.history;

    return (
      <div className="grid gap-8 xl:grid-cols-2">
        <section className="space-y-4">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-5 shadow-lg">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <h2 className="text-xl font-semibold text-white">Active Session</h2>
                <p className="text-sm text-gray-400">
                  Signed by{' '}
                  <span className="text-green-400 font-semibold">{session.signer}</span>
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={handleDownloadPublicKey}
                  className="rounded-md border border-blue-500/40 bg-blue-500/20 px-3 py-1 text-sm font-semibold text-blue-200 transition hover:bg-blue-500/30"
                >
                  Download Public Key
                </button>
                <button
                  onClick={() => onSessionUpdate(null)}
                  className="rounded-md border border-red-500/40 bg-red-500/20 px-3 py-1 text-sm font-semibold text-red-200 transition hover:bg-red-500/30"
                >
                  Reset Session
                </button>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-gray-900 bg-black p-6 shadow-inner">
            <canvas
              ref={canvasRef}
              className="mx-auto max-h-[70vh] w-full rounded-lg bg-gray-900 object-contain"
            />
          </div>

          {history.length > 0 && (
            <div className="rounded-xl border border-gray-800 bg-gray-900/60 p-4">
              <h3 className="flex items-center text-sm font-semibold uppercase tracking-wide text-gray-300">
                <ListBulletIcon className="mr-2" /> Version History
              </h3>
              <div className="mt-3 max-h-40 overflow-y-auto rounded-md bg-gray-950/60 p-3 text-xs text-gray-300">
                <table className="w-full table-fixed">
                  <thead>
                    <tr className="text-left text-gray-500">
                      <th className="w-16 pb-1">Version</th>
                      <th className="w-32 pb-1">Signer</th>
                      <th className="pb-1">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...history].reverse().map((entry) => (
                      <tr key={entry.version} className="border-t border-gray-800/80">
                        <td className="py-1 font-mono">#{entry.version}</td>
                        <td className="py-1">{entry.signer}</td>
                        <td className="py-1 text-gray-400">
                          {new Date(entry.timestamp).toLocaleString()}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </section>

        <section className="flex flex-col gap-6">
          <div className="rounded-xl border border-gray-800 bg-gray-900/70 p-6 shadow-lg">
            <h3 className="text-lg font-semibold text-white">Image Adjustments</h3>
            <p className="mt-1 text-sm text-gray-400">
              Adjust appearance before committing a new, signed version.
            </p>
            <div className="mt-4 space-y-5">
              <div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Brightness</span>
                  <span>{brightness}%</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={brightness}
                  onChange={(event) => setBrightness(Number(event.target.value))}
                  onPointerUp={() => recordEdit({ op: 'brightness', delta: brightness / 100 })}
                  className="mt-2 w-full accent-blue-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Contrast</span>
                  <span>{contrast}%</span>
                </div>
                <input
                  type="range"
                  min={20}
                  max={200}
                  value={contrast}
                  onChange={(event) => setContrast(Number(event.target.value))}
                  onPointerUp={() => recordEdit({ op: 'contrast', delta: contrast / 100 })}
                  className="mt-2 w-full accent-blue-500"
                />
              </div>
              <div>
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Rotation</span>
                  <span>{rotation}°</span>
                </div>
                <input
                  type="range"
                  min={-180}
                  max={180}
                  step={1}
                  value={rotation}
                  onChange={(event) => setRotation(Number(event.target.value))}
                  onPointerUp={() => recordEdit({ op: 'rotate', angle: rotation })}
                  className="mt-2 w-full accent-blue-500"
                />
              </div>

              <div>
                <h4 className="text-sm font-semibold text-gray-300">Filter</h4>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  {FILTER_OPTIONS.map((option) => (
                    <button
                      key={option}
                      onClick={() => {
                        setFilter(option);
                        recordEdit({ op: 'filter', type: option });
                      }}
                      className={`rounded-md border px-3 py-2 text-sm font-semibold transition ${
                        filter === option
                          ? 'border-blue-500 bg-blue-600 text-white'
                          : 'border-gray-700 bg-gray-900/60 text-gray-300 hover:border-blue-500/40 hover:bg-blue-500/10'
                      }`}
                    >
                      {option.charAt(0).toUpperCase() + option.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-3 border-t border-gray-800 pt-4">
                <div className="flex items-center gap-2">
                  <div className="flex-1">
                    <label className="text-sm font-semibold text-gray-300">
                      Text Overlay
                      <input
                        type="text"
                        value={textOverlay.text}
                        placeholder="Add watermark text"
                        onChange={(event) =>
                          setTextOverlay((prev) => ({ ...prev, text: event.target.value }))
                        }
                        onBlur={() =>
                          recordEdit({
                            op: 'text',
                            text: textOverlay.text,
                            x: textOverlay.x,
                            y: textOverlay.y,
                            font: `${textOverlay.size}px sans-serif`,
                            color: textOverlay.color,
                          })
                        }
                        className="mt-1 w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </label>
                  </div>
                  <input
                    type="color"
                    value={textOverlay.color}
                    onChange={(event) =>
                      setTextOverlay((prev) => ({ ...prev, color: event.target.value }))
                    }
                    className="h-10 w-12 cursor-pointer rounded border border-gray-700 bg-gray-950 p-1"
                  />
                </div>

                <div className="grid grid-cols-3 gap-2 text-xs text-gray-400">
                  <label className="space-y-1">
                    <span>Size</span>
                    <input
                      type="range"
                      min={12}
                      max={128}
                      value={textOverlay.size}
                      onChange={(event) =>
                        setTextOverlay((prev) => ({ ...prev, size: Number(event.target.value) }))
                      }
                      className="w-full accent-blue-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span>X (%)</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={textOverlay.x}
                      onChange={(event) =>
                        setTextOverlay((prev) => ({ ...prev, x: Number(event.target.value) }))
                      }
                      className="w-full accent-blue-500"
                    />
                  </label>
                  <label className="space-y-1">
                    <span>Y (%)</span>
                    <input
                      type="range"
                      min={0}
                      max={100}
                      value={textOverlay.y}
                      onChange={(event) =>
                        setTextOverlay((prev) => ({ ...prev, y: Number(event.target.value) }))
                      }
                      className="w-full accent-blue-500"
                    />
                  </label>
                </div>
              </div>
            </div>
          </div>

          <div className="mt-auto space-y-3 rounded-xl border border-gray-800 bg-gray-900/70 p-6 shadow-lg">
            <button
              onClick={handleCommit}
              disabled={isLoading || (history.length > 0 && editLog.length === 0)}
              className="flex w-full items-center justify-center rounded-lg bg-blue-600 py-3 text-lg font-semibold text-white transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:bg-gray-700"
            >
              {isLoading ? (
                <>
                  <Spinner className="mr-2" /> {loadingText || 'Working…'}
                </>
              ) : (
                <>
                  <SparklesIcon className="mr-2" /> Commit Version #{history.length + 1}
                </>
              )}
            </button>
            <button
              onClick={handleDownload}
              disabled={history.length === 0}
              className="flex w-full items-center justify-center rounded-lg border border-gray-800 bg-gray-950 py-3 text-sm font-semibold text-gray-200 transition hover:border-blue-500 hover:text-white disabled:cursor-not-allowed disabled:border-gray-900 disabled:text-gray-600"
            >
              <DownloadIcon className="mr-2" /> Download Current Image
            </button>
          </div>
        </section>
      </div>
    );
  };

  if (isLoading && !session) {
    return (
      <div className="flex h-64 items-center justify-center gap-3 rounded-xl border border-gray-800 bg-gray-900/70 text-white">
        <Spinner /> {loadingText || 'Working…'}
      </div>
    );
  }

  if (session) {
    return renderEditor();
  }

  if (preSessionStep === 'keys') {
    return renderSignerStep();
  }
  if (preSessionStep === 'upload') {
    return renderUploadStep();
  }

  return renderSignerStep();
};

export default ImageWorkflow;

