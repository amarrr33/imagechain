import { ChainedPayload } from '../types';

export interface CriticalMetadata {
  chain_id: string;
  version_count: number;
  last_version_hash: string;
  checksum: string;
}

export interface DctExtractionResult {
  success: boolean;
  metadata: CriticalMetadata | null;
  reason?: string;
}

const BLOCK_SIZE = 8;
const EMBED_POSITIONS: Array<{ u: number; v: number }> = [
  { u: 1, v: 2 },
  { u: 2, v: 1 },
  { u: 2, v: 2 },
  { u: 3, v: 1 },
  { u: 1, v: 3 },
];
const QUANTISATION_STEP = 4;
const METADATA_MAGIC = 'ICMETA1';
const HEADER_BYTES = new TextEncoder().encode(METADATA_MAGIC);
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();

const COS_TABLE = (() => {
  const cosTable: number[][] = new Array(BLOCK_SIZE);
  for (let u = 0; u < BLOCK_SIZE; u += 1) {
    cosTable[u] = new Array(BLOCK_SIZE);
    for (let x = 0; x < BLOCK_SIZE; x += 1) {
      cosTable[u][x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * BLOCK_SIZE));
    }
  }
  return cosTable;
})();

const clamp255 = (value: number) => Math.max(0, Math.min(255, value));

const calculateMetadataChecksum = (
  chainId: string,
  versionCount: number,
  lastHash: string,
): string => {
  const seed = `${chainId}|${versionCount}|${lastHash}`;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
};

const computePayloadChecksum = (payload: Uint8Array): number => {
  let sum = 0;
  for (let i = 0; i < payload.length; i += 1) {
    sum = (sum + payload[i]) >>> 0;
  }
  return sum;
};

const metadataToBytes = (metadata: CriticalMetadata): Uint8Array => {
  const canonical = JSON.stringify({
    chain_id: metadata.chain_id,
    version_count: metadata.version_count,
    last_version_hash: metadata.last_version_hash,
    checksum: metadata.checksum,
  });
  const payloadBytes = TEXT_ENCODER.encode(canonical);
  const payloadLength = payloadBytes.length;
  if (payloadLength > 0xffff) {
    throw new Error('Critical metadata payload too large to embed.');
  }
  const checksum = computePayloadChecksum(payloadBytes);

  const buffer = new Uint8Array(
    HEADER_BYTES.length + 2 + payloadLength + 4,
  );
  let offset = 0;
  buffer.set(HEADER_BYTES, offset);
  offset += HEADER_BYTES.length;
  buffer[offset] = (payloadLength >> 8) & 0xff;
  buffer[offset + 1] = payloadLength & 0xff;
  offset += 2;
  buffer.set(payloadBytes, offset);
  offset += payloadLength;
  buffer[offset] = (checksum >>> 24) & 0xff;
  buffer[offset + 1] = (checksum >>> 16) & 0xff;
  buffer[offset + 2] = (checksum >>> 8) & 0xff;
  buffer[offset + 3] = checksum & 0xff;

  return buffer;
};

const bytesToBits = (bytes: Uint8Array): number[] => {
  const bits: number[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    const current = bytes[i];
    for (let bit = 7; bit >= 0; bit -= 1) {
      bits.push((current >> bit) & 1);
    }
  }
  return bits;
};

const bitsToBytes = (bits: number[]): Uint8Array => {
  const byteLength = Math.floor(bits.length / 8);
  const bytes = new Uint8Array(byteLength);
  for (let i = 0; i < byteLength; i += 1) {
    let value = 0;
    for (let bit = 0; bit < 8; bit += 1) {
      value = (value << 1) | bits[i * 8 + bit];
    }
    bytes[i] = value;
  }
  return bytes;
};

const forwardDct = (block: number[]): number[] => {
  const coeffs = new Array(BLOCK_SIZE * BLOCK_SIZE).fill(0);
  for (let v = 0; v < BLOCK_SIZE; v += 1) {
    for (let u = 0; u < BLOCK_SIZE; u += 1) {
      let sum = 0;
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          sum += block[y * BLOCK_SIZE + x] * COS_TABLE[u][x] * COS_TABLE[v][y];
        }
      }
      const cu = u === 0 ? Math.SQRT1_2 : 1;
      const cv = v === 0 ? Math.SQRT1_2 : 1;
      coeffs[v * BLOCK_SIZE + u] = 0.25 * cu * cv * sum;
    }
  }
  return coeffs;
};

const inverseDct = (coeffs: number[]): number[] => {
  const pixels = new Array(BLOCK_SIZE * BLOCK_SIZE).fill(0);
  for (let y = 0; y < BLOCK_SIZE; y += 1) {
    for (let x = 0; x < BLOCK_SIZE; x += 1) {
      let sum = 0;
      for (let v = 0; v < BLOCK_SIZE; v += 1) {
        for (let u = 0; u < BLOCK_SIZE; u += 1) {
          const cu = u === 0 ? Math.SQRT1_2 : 1;
          const cv = v === 0 ? Math.SQRT1_2 : 1;
          sum += cu * cv * coeffs[v * BLOCK_SIZE + u] * COS_TABLE[u][x] * COS_TABLE[v][y];
        }
      }
      pixels[y * BLOCK_SIZE + x] = sum * 0.25;
    }
  }
  return pixels;
};

const embedBitIntoCoeff = (coeff: number, bit: number): number => {
  const quantised = Math.round(coeff / QUANTISATION_STEP);
  const desiredParity = bit & 1;
  const currentParity = Math.abs(quantised) & 1;
  if (currentParity === desiredParity) {
    return quantised * QUANTISATION_STEP;
  }
  if (quantised >= 0) {
    return (quantised + 1) * QUANTISATION_STEP;
  }
  return (quantised - 1) * QUANTISATION_STEP;
};

const extractBitFromCoeff = (coeff: number): number => {
  const quantised = Math.round(coeff / QUANTISATION_STEP);
  return Math.abs(quantised) & 1;
};

const updateRgbForNewLuma = (
  data: Uint8ClampedArray,
  index: number,
  newY: number,
) => {
  const rWeight = 0.299;
  const gWeight = 0.587;
  const bWeight = 0.114;
  const originalR = data[index];
  const originalG = data[index + 1];
  const originalB = data[index + 2];
  const originalY = originalR * rWeight + originalG * gWeight + originalB * bWeight;
  const delta = newY - originalY;

  data[index] = clamp255(originalR + delta * rWeight);
  data[index + 1] = clamp255(originalG + delta * gWeight);
  data[index + 2] = clamp255(originalB + delta * bWeight);
};

const decodeMetadataBytes = (bytes: Uint8Array): CriticalMetadata | null => {
  if (bytes.length < HEADER_BYTES.length + 2 + 4) {
    return null;
  }
  const header = bytes.slice(0, HEADER_BYTES.length);
  if (!HEADER_BYTES.every((val, idx) => header[idx] === val)) {
    return null;
  }
  const length = (bytes[HEADER_BYTES.length] << 8) | bytes[HEADER_BYTES.length + 1];
  const totalRequired = HEADER_BYTES.length + 2 + length + 4;
  if (bytes.length < totalRequired) {
    return null;
  }
  const payload = bytes.slice(HEADER_BYTES.length + 2, HEADER_BYTES.length + 2 + length);
  const checksumBytes = bytes.slice(totalRequired - 4, totalRequired);
  const checksum =
    (checksumBytes[0] << 24) |
    (checksumBytes[1] << 16) |
    (checksumBytes[2] << 8) |
    checksumBytes[3];
  if (computePayloadChecksum(payload) !== checksum) {
    return null;
  }
  try {
    const parsed = JSON.parse(TEXT_DECODER.decode(payload)) as CriticalMetadata;
    const expected = calculateMetadataChecksum(
      parsed.chain_id,
      parsed.version_count,
      parsed.last_version_hash,
    );
    if (parsed.checksum !== expected) {
      return null;
    }
    return parsed;
  } catch (error) {
    console.warn('Failed to decode DCT metadata JSON:', error);
    return null;
  }
};

export const extractCriticalMetadata = (payload: ChainedPayload): CriticalMetadata => {
  const historyLength = payload.history.length;
  const lastEntry = historyLength > 0 ? payload.history[historyLength - 1] : null;
  const checksum = calculateMetadataChecksum(
    payload.chain_id,
    historyLength,
    lastEntry?.sha256 ?? '',
  );
  return {
    chain_id: payload.chain_id,
    version_count: historyLength,
    last_version_hash: lastEntry?.sha256 ?? '',
    checksum,
  };
};

export const embedCriticalMetadataDCT = (
  canvas: HTMLCanvasElement,
  metadata: CriticalMetadata,
): HTMLCanvasElement => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to acquire 2D context for DCT embedding.');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const blocksX = Math.floor(width / BLOCK_SIZE);
  const blocksY = Math.floor(height / BLOCK_SIZE);
  const bits = bytesToBits(metadataToBytes(metadata));

  let bitIndex = 0;
  for (let by = 0; by < blocksY && bitIndex < bits.length; by += 1) {
    for (let bx = 0; bx < blocksX && bitIndex < bits.length; bx += 1) {
      const block: number[] = new Array(BLOCK_SIZE * BLOCK_SIZE);
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          const px = bx * BLOCK_SIZE + x;
          const py = by * BLOCK_SIZE + y;
          const idx = (py * width + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          block[y * BLOCK_SIZE + x] = r * 0.299 + g * 0.587 + b * 0.114;
        }
      }

      const coeffs = forwardDct(block);
      for (let i = 0; i < EMBED_POSITIONS.length && bitIndex < bits.length; i += 1) {
        const { u, v } = EMBED_POSITIONS[i];
        const index = v * BLOCK_SIZE + u;
        coeffs[index] = embedBitIntoCoeff(coeffs[index], bits[bitIndex]);
        bitIndex += 1;
      }
      const restored = inverseDct(coeffs);

      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          const px = bx * BLOCK_SIZE + x;
          const py = by * BLOCK_SIZE + y;
          const idx = (py * width + px) * 4;
          const newY = clamp255(restored[y * BLOCK_SIZE + x]);
          updateRgbForNewLuma(data, idx, newY);
        }
      }
    }
  }

  if (bitIndex < bits.length) {
    throw new Error('Canvas does not have enough capacity for DCT metadata.');
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas;
};

export const extractCriticalMetadataDCT = (
  canvas: HTMLCanvasElement,
): CriticalMetadata | null => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to acquire 2D context for DCT extraction.');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data, width, height } = imageData;
  const blocksX = Math.floor(width / BLOCK_SIZE);
  const blocksY = Math.floor(height / BLOCK_SIZE);

  const bits: number[] = [];
  for (let by = 0; by < blocksY; by += 1) {
    for (let bx = 0; bx < blocksX; bx += 1) {
      const block: number[] = new Array(BLOCK_SIZE * BLOCK_SIZE);
      for (let y = 0; y < BLOCK_SIZE; y += 1) {
        for (let x = 0; x < BLOCK_SIZE; x += 1) {
          const px = bx * BLOCK_SIZE + x;
          const py = by * BLOCK_SIZE + y;
          const idx = (py * width + px) * 4;
          const r = data[idx];
          const g = data[idx + 1];
          const b = data[idx + 2];
          block[y * BLOCK_SIZE + x] = r * 0.299 + g * 0.587 + b * 0.114;
        }
      }
      const coeffs = forwardDct(block);
      for (let i = 0; i < EMBED_POSITIONS.length; i += 1) {
        const { u, v } = EMBED_POSITIONS[i];
        const index = v * BLOCK_SIZE + u;
        bits.push(extractBitFromCoeff(coeffs[index]));
      }
    }
  }

  const metadata = decodeMetadataBytes(bitsToBytes(bits));
  return metadata;
};

export const tryExtractDCT = (
  canvas: HTMLCanvasElement,
): DctExtractionResult => {
  try {
    const metadata = extractCriticalMetadataDCT(canvas);
    return {
      success: Boolean(metadata),
      metadata,
      reason: metadata ? undefined : 'no_metadata_found',
    };
  } catch (error) {
    return {
      success: false,
      metadata: null,
      reason: error instanceof Error ? error.message : 'unknown_error',
    };
  }
};
