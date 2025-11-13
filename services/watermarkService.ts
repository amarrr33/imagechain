import pako from 'pako';
import type { ChainedPayload } from '../types';
import {
  CriticalMetadata,
  embedCriticalMetadataDCT,
  extractCriticalMetadata,
  extractCriticalMetadataDCT,
} from './dctService';

const REPETITION_FACTOR = 3;
const TEXT_ENCODER = new TextEncoder();
const TEXT_DECODER = new TextDecoder();
const LSB_MAGIC = TEXT_ENCODER.encode('ICLSB01');
const LSB_END_MARKER = TEXT_ENCODER.encode('ICEND01');

const checksum32 = (bytes: Uint8Array): number => {
  let sum = 0;
  for (let i = 0; i < bytes.length; i += 1) {
    sum = (sum + bytes[i]) >>> 0;
  }
  return sum;
};

const withRepetition = (bytes: Uint8Array): Uint8Array => {
  const repeated = new Uint8Array(bytes.length * REPETITION_FACTOR);
  for (let i = 0; i < bytes.length; i += 1) {
    for (let r = 0; r < REPETITION_FACTOR; r += 1) {
      repeated[i * REPETITION_FACTOR + r] = bytes[i];
    }
  }
  return repeated;
};

const majorityVote = (chunk: Uint8Array): { value: number; mismatches: number } => {
  const counts = new Map<number, number>();
  for (let i = 0; i < chunk.length; i += 1) {
    const byte = chunk[i];
    counts.set(byte, (counts.get(byte) ?? 0) + 1);
  }
  let bestValue = chunk[0];
  let bestCount = 0;
  counts.forEach((count, value) => {
    if (count > bestCount) {
      bestCount = count;
      bestValue = value;
    }
  });
  return { value: bestValue, mismatches: chunk.length - bestCount };
};

const recoverRepetition = (
  data: Uint8Array,
): { bytes: Uint8Array; mismatches: number } => {
  const usableLength = Math.floor(data.length / REPETITION_FACTOR) * REPETITION_FACTOR;
  const decoded = new Uint8Array(usableLength / REPETITION_FACTOR);
  let mismatches = 0;
  for (let i = 0; i < usableLength; i += REPETITION_FACTOR) {
    const chunk = data.subarray(i, i + REPETITION_FACTOR);
    const { value, mismatches: chunkErrors } = majorityVote(chunk);
    decoded[i / REPETITION_FACTOR] = value;
    mismatches += chunkErrors;
  }
  return { bytes: decoded, mismatches };
};

const framePayload = (payload: ChainedPayload): Uint8Array => {
  const json = TEXT_ENCODER.encode(JSON.stringify(payload));
  const compressed = pako.deflate(json);
  const hash = checksum32(compressed);
  const frame = new Uint8Array(
    LSB_MAGIC.length + 4 + 4 + compressed.length + LSB_END_MARKER.length,
  );
  let offset = 0;
  frame.set(LSB_MAGIC, offset);
  offset += LSB_MAGIC.length;
  const length = compressed.length;
  frame[offset] = (length >>> 24) & 0xff;
  frame[offset + 1] = (length >>> 16) & 0xff;
  frame[offset + 2] = (length >>> 8) & 0xff;
  frame[offset + 3] = length & 0xff;
  offset += 4;
  frame[offset] = (hash >>> 24) & 0xff;
  frame[offset + 1] = (hash >>> 16) & 0xff;
  frame[offset + 2] = (hash >>> 8) & 0xff;
  frame[offset + 3] = hash & 0xff;
  offset += 4;
  frame.set(compressed, offset);
  offset += compressed.length;
  frame.set(LSB_END_MARKER, offset);
  return frame;
};

const embedBytesAsLsb = (
  canvas: HTMLCanvasElement,
  bytes: Uint8Array,
): void => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to acquire canvas context for embedding.');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const requiredBits = bytes.length * 8;
  const availableBits = Math.floor((data.length / 4) * 3);
  if (requiredBits > availableBits) {
    throw new Error(
      `Payload exceeds LSB capacity. Needed ${requiredBits}, available ${availableBits}.`,
    );
  }
  let bitIndex = 0;
  for (let i = 0; i < data.length && bitIndex < requiredBits; i += 1) {
    if ((i + 1) % 4 === 0) continue;
    const byteIndex = Math.floor(bitIndex / 8);
    const bitOffset = 7 - (bitIndex % 8);
    const bit = (bytes[byteIndex] >> bitOffset) & 1;
    data[i] = (data[i] & 0xfe) | bit;
    bitIndex += 1;
  }
  ctx.putImageData(imageData, 0, 0);
};

const extractLsbBytes = (canvas: HTMLCanvasElement): Uint8Array => {
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) {
    throw new Error('Unable to acquire canvas context for extraction.');
  }
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data } = imageData;
  const totalBits = Math.floor((data.length / 4) * 3);
  const byteLength = Math.floor(totalBits / 8);
  const bytes = new Uint8Array(byteLength);
  let bitIndex = 0;
  for (let i = 0; i < data.length && bitIndex < byteLength * 8; i += 1) {
    if ((i + 1) % 4 === 0) continue;
    const bytePosition = Math.floor(bitIndex / 8);
    const bitOffset = 7 - (bitIndex % 8);
    const bit = data[i] & 1;
    bytes[bytePosition] |= bit << bitOffset;
    bitIndex += 1;
  }
  return bytes;
};

const locateFrame = (bytes: Uint8Array): Uint8Array | null => {
  const magicLength = LSB_MAGIC.length;
  const footerLength = LSB_END_MARKER.length;
  for (let start = 0; start <= bytes.length - (magicLength + 8 + footerLength); start += 1) {
    let matches = true;
    for (let i = 0; i < magicLength; i += 1) {
      if (bytes[start + i] !== LSB_MAGIC[i]) {
        matches = false;
        break;
      }
    }
    if (!matches) {
      continue;
    }
    const lengthOffset = start + magicLength;
    const payloadLength =
      (bytes[lengthOffset] << 24) |
      (bytes[lengthOffset + 1] << 16) |
      (bytes[lengthOffset + 2] << 8) |
      bytes[lengthOffset + 3];
    const checksumOffset = lengthOffset + 4;
    const totalFrameLength =
      magicLength + 4 + 4 + payloadLength + footerLength;
    if (start + totalFrameLength > bytes.length) {
      continue;
    }
    let footerMatches = true;
    const footerStart = start + totalFrameLength - footerLength;
    for (let i = 0; i < footerLength; i += 1) {
      if (bytes[footerStart + i] !== LSB_END_MARKER[i]) {
        footerMatches = false;
        break;
      }
    }
    if (!footerMatches) {
      continue;
    }
    return bytes.slice(start, start + totalFrameLength);
  }
  return null;
};

const parseFrame = (
  frame: Uint8Array,
): { payload: ChainedPayload; checksumMatched: boolean } | null => {
  const magicLength = LSB_MAGIC.length;
  const footerLength = LSB_END_MARKER.length;
  const lengthOffset = magicLength;
  const payloadLength =
    (frame[lengthOffset] << 24) |
    (frame[lengthOffset + 1] << 16) |
    (frame[lengthOffset + 2] << 8) |
    frame[lengthOffset + 3];
  const checksumOffset = lengthOffset + 4;
  const checksum =
    (frame[checksumOffset] << 24) |
    (frame[checksumOffset + 1] << 16) |
    (frame[checksumOffset + 2] << 8) |
    frame[checksumOffset + 3];
  const payloadStart = checksumOffset + 4;
  const payloadEnd = payloadStart + payloadLength;
  const compressed = frame.slice(payloadStart, payloadEnd);
  const computedChecksum = checksum32(compressed);
  try {
    const decompressed = pako.inflate(compressed, { to: 'string' });
    const payload = JSON.parse(decompressed) as ChainedPayload;
    return {
      payload,
      checksumMatched: computedChecksum === checksum,
    };
  } catch (error) {
    console.error('Failed to decompress embedded payload:', error);
    return null;
  }
};

export interface ExtractionResult {
  payload: ChainedPayload | null;
  recovered: boolean;
  corruptionDetected: boolean;
  errorRate?: number;
  criticalMetadata?: CriticalMetadata | null;
  dctExtracted?: boolean;
}

const extractInternal = (canvas: HTMLCanvasElement): ExtractionResult => {
  let criticalMetadata: CriticalMetadata | null = null;
  let dctExtracted = false;
  try {
    criticalMetadata = extractCriticalMetadataDCT(canvas);
    dctExtracted = Boolean(criticalMetadata);
  } catch (error) {
    console.warn('DCT extraction failed:', error);
  }

  const rawBytes = extractLsbBytes(canvas);
  const { bytes: decodedBytes, mismatches } = recoverRepetition(rawBytes);
  const encodedFrame = locateFrame(decodedBytes);

  if (!encodedFrame) {
    return {
      payload: null,
      recovered: false,
      corruptionDetected: true,
      errorRate: mismatches / Math.max(1, decodedBytes.length * REPETITION_FACTOR),
      criticalMetadata,
      dctExtracted,
    };
  }

  const parsed = parseFrame(encodedFrame);
  if (!parsed) {
    return {
      payload: null,
      recovered: false,
      corruptionDetected: true,
      errorRate: mismatches / Math.max(1, decodedBytes.length * REPETITION_FACTOR),
      criticalMetadata,
      dctExtracted,
    };
  }

  const { payload, checksumMatched } = parsed;
  if (criticalMetadata && !payload._dct_metadata) {
    payload._dct_metadata = {
      chain_id: criticalMetadata.chain_id,
      version_count: criticalMetadata.version_count,
      last_version_hash: criticalMetadata.last_version_hash,
    };
  }

  return {
    payload: checksumMatched ? payload : null,
    recovered: mismatches > 0,
    corruptionDetected: !checksumMatched || mismatches > 0,
    errorRate: mismatches / Math.max(1, decodedBytes.length * REPETITION_FACTOR),
    criticalMetadata,
    dctExtracted,
  };
};

export const embedPayload = (
  canvas: HTMLCanvasElement,
  payload: ChainedPayload,
): HTMLCanvasElement => {
  const metadata = extractCriticalMetadata(payload);
  try {
    embedCriticalMetadataDCT(canvas, metadata);
  } catch (error) {
    console.warn('Failed to embed critical metadata via DCT:', error);
  }
  const frame = framePayload(payload);
  const redundantFrame = withRepetition(frame);
  embedBytesAsLsb(canvas, redundantFrame);
  return canvas;
};

export const extractPayloadWithDetails = async (
  canvas: HTMLCanvasElement,
): Promise<ExtractionResult> => {
  try {
    return extractInternal(canvas);
  } catch (error) {
    console.error('Payload extraction failed:', error);
    return {
      payload: null,
      recovered: false,
      corruptionDetected: true,
    };
  }
};

export const extractPayloadAsync = async (
  canvas: HTMLCanvasElement,
): Promise<ChainedPayload | null> => {
  const result = await extractPayloadWithDetails(canvas);
  return result.payload;
};
