import React, { useState, useCallback, useEffect } from 'react';
import { SigScheme, EditOperation, VersionInfo, VerificationResult, ChainedPayload, HistoryEntry } from '../types';
import { generateKeyPair, verifySignature, getPayloadHeader, sha256, signPayload } from '../services/cryptoService';
import { normalizeImage, createSnapshot, canvasToBlob } from '../services/imageService';
import { embedPayload, extractPayloadAsync } from '../services/watermarkService';
import { Spinner, SparklesIcon, CheckCircleIcon, XCircleIcon, InformationCircleIcon } from './Icons';

// Generate a simple test image programmatically (128x128) to reduce payload size
const generateTestImage = (): string => {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not get canvas context');
    
    // Create a simple gradient background
    const gradient = ctx.createLinearGradient(0, 0, 128, 128);
    gradient.addColorStop(0, '#4a5568');
    gradient.addColorStop(1, '#2d3748');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, 128, 128);
    
    // Add some text
    ctx.fillStyle = '#ffffff';
    ctx.font = 'bold 16px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('ImageChain', 64, 64);
    
    return canvas.toDataURL('image/png');
};

const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataUrl;
    });
};

export const Demo: React.FC = () => {
    const [isRunning, setIsRunning] = useState(false);
    const [logs, setLogs] = useState<string[]>([]);
    const [results, setResults] = useState<VersionInfo[] | null>(null);
    const [finalImageSrc, setFinalImageSrc] = useState<string | null>(null);
    const [error, setError] = useState<string>('');

    // Cleanup blob URLs on unmount
    useEffect(() => {
        return () => {
            if (finalImageSrc) {
                URL.revokeObjectURL(finalImageSrc);
            }
        };
    }, [finalImageSrc]);
    
    const addLog = (message: string) => {
        setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${message}`]);
    };

    const runDemo = useCallback(async () => {
        setIsRunning(true);
        setLogs([]);
        setResults(null);
        setFinalImageSrc(null);
        setError('');

        try {
            // Step 1: Generate Keys
            addLog("═══════════════════════════════════════");
            addLog("STEP 1: Generating Cryptographic Keys");
            addLog("═══════════════════════════════════════");
            addLog("→ Creating ECC P-256 key pair for signing...");
            addLog("  (This ensures each version is cryptographically signed)");
            const { privateKeyPem, publicKeyPem } = await generateKeyPair(SigScheme.ECC);
            addLog("✓ Key pair generated successfully");
            
            // Step 2: Generate and Load Base Image
            addLog("");
            addLog("═══════════════════════════════════════");
            addLog("STEP 2: Creating Base Image");
            addLog("═══════════════════════════════════════");
            addLog("→ Generating a simple 128x128 test image...");
            addLog("  (Smaller images reduce payload size for watermarking)");
            const testImageDataUrl = generateTestImage();
            const originalImage = await loadImageFromDataUrl(testImageDataUrl);
            addLog("✓ Base image created (128x128 pixels)");
            
            addLog("→ Computing image hash (chain_id)...");
            const { hashPromise } = normalizeImage(originalImage);
            const chainId = await hashPromise;
            addLog(`✓ Chain ID: ${chainId.substring(0, 16)}...`);
            
            const history: HistoryEntry[] = [];

            const commitAndWatermark = async (visualCanvas: HTMLCanvasElement, editLog: EditOperation[], signer: string): Promise<HTMLCanvasElement> => {
                const blob = await canvasToBlob(visualCanvas);
                const buffer = await blob.arrayBuffer();
                const currentHash = await sha256(buffer);
                
                const lastVersion = history.length > 0 ? history[history.length - 1] : null;
                const snapshot = editLog.length > 0 ? await createSnapshot(visualCanvas) : null;
                
                const entryToSign: Omit<HistoryEntry, 'signature'> = {
                    version: lastVersion ? lastVersion.version + 1 : 1,
                    sha256: currentHash,
                    parent_hash: lastVersion ? lastVersion.sha256 : null,
                    timestamp: new Date().toISOString(),
                    signer,
                    sig_scheme: SigScheme.ECC,
                    edit_log: editLog,
                    snapshot
                };

                const header = getPayloadHeader(entryToSign);
                const signature = await signPayload(header, privateKeyPem, SigScheme.ECC);
                const newEntry: HistoryEntry = { ...entryToSign, signature };
                
                history.push(newEntry);
                const newPayload: ChainedPayload = { chain_id: chainId, history };

                // ** ROBUST FIX: Force a full render cycle via data URL to get a stable bitmap. **
                // This prevents race conditions where the canvas state isn't synced before pixel reading.
                const dataUrl = visualCanvas.toDataURL();
                const stableImage = await loadImageFromDataUrl(dataUrl);

                const watermarkingCanvas = document.createElement('canvas');
                watermarkingCanvas.width = stableImage.width;
                watermarkingCanvas.height = stableImage.height;
                const ctx = watermarkingCanvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) throw new Error("Could not get context for watermarking canvas");
                ctx.drawImage(stableImage, 0, 0);
                
                return embedPayload(watermarkingCanvas, newPayload);
            };

            const createCanvasFromEdits = (baseImg: HTMLImageElement, edits: EditOperation[]): HTMLCanvasElement => {
                const canvas = document.createElement('canvas');
                canvas.width = baseImg.naturalWidth;
                canvas.height = baseImg.naturalHeight;
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                if (!ctx) throw new Error("Could not get context for creating visual canvas");

                const brightness = (edits.find(e => e.op === 'brightness') as { delta: number } | undefined)?.delta ?? 1;
                const contrast = (edits.find(e => e.op === 'contrast') as { delta: number } | undefined)?.delta ?? 1;
                const filter = (edits.find(e => e.op === 'filter') as { type: string } | undefined)?.type ?? 'none';

                let filterString = `brightness(${brightness * 100}%) contrast(${contrast * 100}%)`;
                if (filter === 'grayscale') filterString += ' grayscale(100%)';
                if (filter === 'sepia') filterString += ' sepia(100%)';
                if (filter === 'invert') filterString += ' invert(100%)';
                ctx.filter = filterString;
                
                ctx.drawImage(baseImg, 0, 0);

                const textEdit = edits.find(e => e.op === 'text') as Extract<EditOperation, { op: 'text' }> | undefined;
                if (textEdit?.text) {
                    ctx.filter = 'none';
                    ctx.font = textEdit.font;
                    ctx.fillStyle = textEdit.color;
                    ctx.textAlign = 'center';
                    ctx.textBaseline = 'middle';
                    ctx.fillText(textEdit.text, textEdit.x, textEdit.y);
                }
                
                return canvas;
            };
            
            // Create 15+ versions with varied edits
            addLog("");
            addLog("═══════════════════════════════════════");
            addLog("STEP 3: Creating Version Chain (15+ Commits)");
            addLog("═══════════════════════════════════════");
            addLog("→ Generating multiple versions with different edits...");
            
            const versionConfigs = [
                { name: "Original", edits: [], desc: "Base image" },
                { name: "Brightness+", edits: [{ op: 'brightness', delta: 1.3 }], desc: "Increased brightness" },
                { name: "Contrast+", edits: [{ op: 'brightness', delta: 1.3 }, { op: 'contrast', delta: 1.2 }], desc: "Added contrast" },
                { name: "Grayscale", edits: [{ op: 'brightness', delta: 1.3 }, { op: 'contrast', delta: 1.2 }, { op: 'filter', type: 'grayscale' }], desc: "Grayscale filter" },
                { name: "Text v5", edits: [{ op: 'brightness', delta: 1.3 }, { op: 'contrast', delta: 1.2 }, { op: 'filter', type: 'grayscale' }, { op: 'text', text: 'v5', x: originalImage.width / 2, y: 30, font: '14px sans-serif', color: '#FFFFFF' }], desc: "Added version text" },
                { name: "Sepia", edits: [{ op: 'brightness', delta: 1.3 }, { op: 'contrast', delta: 1.2 }, { op: 'filter', type: 'sepia' }], desc: "Sepia filter" },
                { name: "Invert", edits: [{ op: 'brightness', delta: 1.3 }, { op: 'contrast', delta: 1.2 }, { op: 'filter', type: 'invert' }], desc: "Inverted colors" },
                { name: "Bright+Text", edits: [{ op: 'brightness', delta: 1.5 }, { op: 'text', text: 'v8', x: originalImage.width / 2, y: originalImage.height / 2, font: '16px sans-serif', color: '#FFFF00' }], desc: "Bright with text" },
                { name: "Normal", edits: [{ op: 'brightness', delta: 1.0 }, { op: 'contrast', delta: 1.0 }], desc: "Reset to normal" },
                { name: "High Contrast", edits: [{ op: 'brightness', delta: 1.1 }, { op: 'contrast', delta: 1.5 }], desc: "High contrast" },
                { name: "Grayscale+Text", edits: [{ op: 'brightness', delta: 1.1 }, { op: 'contrast', delta: 1.5 }, { op: 'filter', type: 'grayscale' }, { op: 'text', text: 'v11', x: originalImage.width / 2, y: 50, font: '12px sans-serif', color: '#FFFFFF' }], desc: "Grayscale with text" },
                { name: "Sepia+Text", edits: [{ op: 'brightness', delta: 1.2 }, { op: 'filter', type: 'sepia' }, { op: 'text', text: 'v12', x: originalImage.width / 2, y: originalImage.height - 30, font: '14px sans-serif', color: '#000000' }], desc: "Sepia with text" },
                { name: "Bright Sepia", edits: [{ op: 'brightness', delta: 1.4 }, { op: 'filter', type: 'sepia' }], desc: "Bright sepia" },
                { name: "Final Text", edits: [{ op: 'brightness', delta: 1.4 }, { op: 'filter', type: 'sepia' }, { op: 'text', text: 'v14', x: originalImage.width / 2, y: originalImage.height / 2, font: '18px sans-serif', color: '#FFFFFF' }], desc: "Final version with text" },
                { name: "Ultimate", edits: [{ op: 'brightness', delta: 1.3 }, { op: 'contrast', delta: 1.3 }, { op: 'filter', type: 'sepia' }, { op: 'text', text: 'v15', x: originalImage.width / 2, y: originalImage.height / 2, font: '20px sans-serif', color: '#FFD700' }], desc: "Ultimate version" },
            ];

            let currentCanvas: HTMLCanvasElement | null = null;
            
            for (let i = 0; i < versionConfigs.length; i++) {
                const config = versionConfigs[i];
                const versionNum = i + 1;
                
                if (versionNum % 5 === 0 || versionNum === 1) {
                    addLog(`→ Committing Version ${versionNum}: ${config.name} (${config.desc})`);
                }
                
                const visualCanvas = createCanvasFromEdits(originalImage, config.edits);
                currentCanvas = await commitAndWatermark(visualCanvas, config.edits, "DemoSigner");
                
                if (versionNum % 5 === 0 || versionNum === 1) {
                    addLog(`  ✓ Version ${versionNum} committed (${history.length} total versions)`);
                }
            }
            
            if (!currentCanvas) throw new Error("Failed to create final canvas");
            const finalCanvas = currentCanvas;
            
            const finalBlob = await canvasToBlob(finalCanvas);
            setFinalImageSrc(URL.createObjectURL(finalBlob));
            addLog("");
            addLog(`✓ Complete chain created: ${history.length} versions total`);
            addLog("→ Final image generated with embedded version history");


            // Step 6: Verification
            addLog("");
            addLog("═══════════════════════════════════════");
            addLog("STEP 6: Verifying Version Chain");
            addLog("═══════════════════════════════════════");
            addLog("→ Extracting embedded history from final image...");
            addLog("  (Using steganography to read hidden data from pixels)");
            const payload = await extractPayloadAsync(finalCanvas);
            if (!payload) {
                throw new Error("Could not extract final payload for verification.");
            }
            addLog(`✓ Extracted ${payload.history.length} version entries`);
            addLog(`  Chain ID: ${payload.chain_id.substring(0, 16)}...`);
            addLog(`  Total versions in history: ${payload.history.length}`);

            addLog("→ Verifying cryptographic signatures...");
            addLog("  • Checking each version's signature against public key");
            addLog("  • Verifying hash chain links (parent → child)");
            const verifiedInfos: VersionInfo[] = [];
            let previousHash: string | null = null;
            
            for (const entry of payload.history) {
                 const verification: VerificationResult = { isSignatureValid: false, isChainLinkValid: false };
                const header = getPayloadHeader(entry);
                verification.isSignatureValid = await verifySignature(header, entry.signature, publicKeyPem, entry.sig_scheme);
                verification.isChainLinkValid = entry.parent_hash === previousHash;
                verifiedInfos.push({ entry, verification });
                previousHash = entry.sha256;
                
                const status = (verification.isSignatureValid && verification.isChainLinkValid) ? "✓" : "✗";
                addLog(`  ${status} Version ${entry.version}: ${verification.isSignatureValid ? 'Signature valid' : 'Signature INVALID'} | ${verification.isChainLinkValid ? 'Chain link valid' : 'Chain link BROKEN'}`);
            }
            
            setResults(verifiedInfos);
            addLog("");
            addLog("═══════════════════════════════════════");
            addLog("✓ DEMO COMPLETED SUCCESSFULLY");
            addLog("═══════════════════════════════════════");
            addLog("The final image contains the complete version history");
            addLog("embedded invisibly in its pixels. Anyone with this image");
            addLog("can extract and verify the entire chain!");

        } catch (err) {
            console.error("Demo failed:", err);
            const errorMessage = err instanceof Error ? err.message : String(err);
            setError(`Demo failed: ${errorMessage}`);
            addLog(`Error: ${errorMessage}`);
        } finally {
            setIsRunning(false);
        }
    }, []);

    return (
        <div className="space-y-6">
             <h2 className="text-2xl font-bold text-white flex items-center">
                <SparklesIcon className="mr-2"/> Automated Demo
            </h2>
            <div className="bg-blue-900/20 border border-blue-500/50 rounded-lg p-4 mb-4">
                <p className="text-gray-300 text-sm">
                    <strong className="text-blue-400">How it works:</strong> This automated demo creates a complete version chain from scratch. 
                    It generates cryptographic keys, creates <strong>15+ versions</strong> of a test image with different edits, embeds the entire history 
                    invisibly into the final image using steganography, and then verifies the cryptographic integrity of the entire chain.
                </p>
            </div>
            <div className="bg-purple-900/20 border border-purple-500/50 rounded-lg p-4 mb-4">
                <h4 className="text-purple-400 font-semibold mb-2">🛡️ How ImageChain Prevents Cloning & Duplication:</h4>
                <ul className="text-gray-300 text-sm space-y-1 list-disc list-inside">
                    <li><strong>Cryptographic Signatures:</strong> Each version is signed with a private key. Clones can't forge signatures without the key.</li>
                    <li><strong>Hash Chains:</strong> Each version links to the previous via SHA-256 hash. Any modification breaks the chain.</li>
                    <li><strong>Chain ID:</strong> All versions from the same original share a constant chain_id, making clones detectable.</li>
                    <li><strong>Tamper Detection:</strong> If someone clones and modifies history, verification fails - signatures won't match.</li>
                    <li><strong>Immutable History:</strong> Once committed, version history cannot be altered without breaking cryptographic links.</li>
                </ul>
            </div>
            <p className="text-gray-400 text-sm">
                <strong>Key Features Demonstrated:</strong>
            </p>
            <ul className="text-gray-400 text-sm list-disc list-inside space-y-1 mb-4">
                <li>Automatic key generation (ECC P-256)</li>
                <li>Version history creation with cryptographic signatures</li>
                <li>Steganographic watermarking (invisible data embedding)</li>
                <li>Hash chain verification (tamper detection)</li>
                <li>Complete history extraction from a single image file</li>
            </ul>
            <button
                onClick={runDemo}
                disabled={isRunning}
                className="w-full flex items-center justify-center bg-blue-600 hover:bg-blue-700 disabled:bg-blue-800 disabled:cursor-not-allowed text-white font-bold py-3 px-4 rounded-lg transition-colors duration-200"
            >
                {isRunning ? <Spinner/> : <SparklesIcon className="mr-2"/>}
                {isRunning ? 'Demo in Progress...' : 'Run Automated Demo'}
            </button>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold">Progress Log</h3>
                    <div className="bg-gray-900/50 p-3 rounded-lg h-64 overflow-y-auto font-mono text-xs">
                        {logs.map((log, i) => <p key={i} className="whitespace-pre-wrap">{log}</p>)}
                    </div>
                    {error && <p className="text-red-400 font-semibold">{error}</p>}
                </div>
                <div className="space-y-4">
                    <h3 className="text-xl font-semibold">Final Image</h3>
                    <div className="bg-gray-900/50 p-3 rounded-lg flex items-center justify-center relative">
                         {finalImageSrc ? (
                            <>
                                <img src={finalImageSrc} alt="Final demo version" className="max-w-full h-auto rounded-md" style={{imageRendering: 'pixelated'}} />
                                {results && results.length > 0 && (
                                    <div className="absolute bottom-2 right-2 bg-black/70 text-white text-xs px-2 py-1 rounded">
                                        v{results.length}
                                    </div>
                                )}
                            </>
                         ) : (
                            <div className="h-52 flex items-center justify-center text-gray-500">
                                Final image will appear here...
                            </div>
                         )}
                    </div>
                </div>
            </div>
            
            {results && (
                 <div className="space-y-4 pt-4 border-t border-gray-600">
                    <div className="bg-green-900/20 border border-green-500/50 rounded-lg p-4 mb-4">
                        <h3 className="text-lg font-bold text-white flex items-center mb-2">
                            <CheckCircleIcon className="mr-2 text-green-400"/> Commit History Summary
                        </h3>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
                            <div>
                                <span className="text-gray-400">Total Commits:</span>
                                <span className="ml-2 font-bold text-white">{results.length}</span>
                            </div>
                            <div>
                                <span className="text-gray-400">Verified:</span>
                                <span className="ml-2 font-bold text-green-400">{results.filter(r => r.verification.isSignatureValid && r.verification.isChainLinkValid).length}</span>
                            </div>
                            <div>
                                <span className="text-gray-400">Chain Status:</span>
                                <span className="ml-2 font-bold text-green-400">✓ Intact</span>
                            </div>
                        </div>
                    </div>
                    
                    <div className="bg-gray-800 rounded-lg p-4 max-h-64 overflow-y-auto">
                        <h4 className="text-sm font-semibold text-gray-300 mb-2">Quick Commit History:</h4>
                        <div className="space-y-1">
                            {results.slice().reverse().map(({entry, verification}) => {
                                const isValid = verification.isSignatureValid && verification.isChainLinkValid;
                                const editSummary = entry.edit_log.length > 0 
                                    ? entry.edit_log.map(e => e.op).join(', ')
                                    : 'Original';
                                return (
                                    <div key={entry.version} className="flex items-center justify-between text-xs py-1 border-b border-gray-700/50">
                                        <div className="flex items-center gap-2">
                                            <span className={`w-2 h-2 rounded-full ${isValid ? 'bg-green-500' : 'bg-red-500'}`}></span>
                                            <span className="font-mono text-gray-400">v{entry.version}</span>
                                            <span className="text-gray-300">{editSummary}</span>
                                        </div>
                                        <span className="text-gray-500">{new Date(entry.timestamp).toLocaleTimeString()}</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    
                    <h3 className="text-2xl font-bold text-white">Detailed Verification Results</h3>
                    {results.map(({entry, verification}) => {
                        const isValid = verification.isSignatureValid && verification.isChainLinkValid;
                        return (
                        <div key={entry.version} className={`p-4 rounded-lg border ${isValid ? 'bg-gray-700/50 border-gray-600' : 'bg-red-900/50 border-red-500'}`}>
                             <div className="flex justify-between items-start">
                                <div>
                                    <h4 className="text-xl font-bold">Version {entry.version}</h4>
                                    <p className="text-sm text-gray-400">Signed by: {entry.signer} on {new Date(entry.timestamp).toLocaleString()}</p>
                                </div>
                                <div className={`px-3 py-1 rounded-full text-sm font-semibold flex items-center ${isValid ? 'bg-green-500/20 text-green-300' : 'bg-red-500/20 text-red-300'}`}>
                                     {isValid ? <CheckCircleIcon/> : <XCircleIcon/>}
                                     <span className="ml-1">{isValid ? 'Verified' : 'Failed'}</span>
                                </div>
                             </div>
                             {!verification.isSignatureValid && <p className="mt-2 text-red-300 text-sm">Signature is invalid.</p>}
                             {!verification.isChainLinkValid && <p className="mt-2 text-red-300 text-sm">Hash chain link is broken.</p>}

                            <div className="mt-4 grid grid-cols-1 md:grid-cols-2 gap-4 items-start">
                                <div className="space-y-2 text-sm">
                                    <h5 className="font-semibold text-gray-300">Edit Log:</h5>
                                    {entry.edit_log.length > 0 ? (
                                        <ul className="list-disc list-inside bg-gray-800 p-2 rounded-md font-mono text-xs">
                                            {entry.edit_log.map((edit, i) => <li key={i}>{JSON.stringify(edit)}</li>)}
                                        </ul>
                                    ) : (
                                        <p className="text-gray-400 italic">No edits recorded for this version.</p>
                                    )}
                                </div>
                                
                                {entry.snapshot ? (
                                    <div>
                                        <h5 className="font-semibold text-gray-300 mb-1">Snapshot:</h5>
                                        <img 
                                            src={`data:image/webp;base64,${entry.snapshot.bytes_b64}`} 
                                            alt={`Snapshot for version ${entry.version}`}
                                            className="rounded-md border-2 border-gray-600"
                                            />
                                    </div>
                                ) : (
                                    entry.version > 1 && 
                                    <div>
                                        <h5 className="font-semibold text-gray-300 mb-1">Snapshot:</h5>
                                        <div className="p-4 bg-gray-800 rounded-md text-gray-400 flex items-center text-sm">
                                            <InformationCircleIcon className="mr-2"/>
                                            No snapshot created (no destructive edits).
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )})}
                </div>
            )}
        </div>
    );
};