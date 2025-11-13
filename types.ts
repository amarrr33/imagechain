export enum SigScheme {
  RSA = 'rsa-pss-sha256',
  ECC = 'ecdsa-p256-sha256',
}

export type FilterType = 'grayscale' | 'sepia' | 'invert' | 'none';

export type EditOperation =
  | { op: 'brightness'; delta: number }
  | { op: 'contrast'; delta: number }
  | { op: 'crop'; x: number; y: number; w: number; h: number }
  | { op: 'rotate'; angle: number }
  | { op: 'compress'; quality: number }
  | { op: 'filter'; type: FilterType }
  | { op: 'text'; text: string; x: number; y: number; font: string; color: string; };

export interface Snapshot {
  w: number;
  h: number;
  codec: 'webp';
  bytes_b64: string;
}

export interface HistoryEntry {
  version: number;
  sha256: string; // The hash of the image canvas at this version
  parent_hash: string | null;
  timestamp: string;
  signer: string;
  sig_scheme: SigScheme;
  edit_log: EditOperation[];
  snapshot: Snapshot | null;
  signature: string; // Signature over all other fields in this entry
}

export interface ChainedPayload {
  chain_id: string; // sha256 of the original, un-watermarked image. Stays constant.
  history: HistoryEntry[];
  // Optional: Critical metadata extracted from DCT (when LSB data is lost)
  _dct_metadata?: {
    chain_id: string;
    version_count: number;
    last_version_hash: string;
  };
}

export interface VerificationResult {
  isSignatureValid: boolean;
  isChainLinkValid: boolean;
  error?: string;
  corruptionDetected?: boolean;
  recoveryAttempted?: boolean;
}

export interface VersionInfo {
    entry: HistoryEntry;
    verification: VerificationResult;
}

// Data for sharing state between components
export interface Keys {
    privateKeyPem: string;
    publicKeyPem: string;
}

export interface PreSessionState {
  signerInput: string;
  sigScheme: SigScheme;
}

export interface SessionData {
  keys: Keys;
  signer: string;
  payload: ChainedPayload;
  currentImageSrc: string; // Data URL of the latest canvas state
  baseFileName: string;
}
