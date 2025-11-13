import type { ChainedPayload } from '../types';
import { renderCanvasFromImage } from './imageService';
import { tryExtractDCT } from './dctService';
import { extractPayloadWithDetails, ExtractionResult } from './watermarkService';

// Try more rotation angles to handle various orientations
const DEFAULT_ROTATIONS = [0, 90, 180, 270, -90, -180, -270];

const rotateCanvas = (
  source: HTMLCanvasElement,
  degrees: number,
): HTMLCanvasElement => {
  // Normalize degrees to 0-360 range
  const normalizedDegrees = ((degrees % 360) + 360) % 360;
  if (normalizedDegrees === 0) {
    return source;
  }
  const radians = (normalizedDegrees * Math.PI) / 180;
  const sin = Math.abs(Math.sin(radians));
  const cos = Math.abs(Math.cos(radians));
  const width = source.width;
  const height = source.height;
  const rotatedWidth = Math.max(1, Math.round(width * cos + height * sin));
  const rotatedHeight = Math.max(1, Math.round(width * sin + height * cos));

  const canvas = document.createElement('canvas');
  canvas.width = rotatedWidth;
  canvas.height = rotatedHeight;
  const ctx = canvas.getContext('2d', { 
    willReadFrequently: true,
    imageSmoothingEnabled: false, // Disable smoothing to preserve LSB bits
    imageSmoothingQuality: 'low'
  });
  if (!ctx) {
    throw new Error('Unable to rotate canvas: 2D context unavailable.');
  }
  ctx.translate(rotatedWidth / 2, rotatedHeight / 2);
  ctx.rotate(radians);
  ctx.drawImage(source, -width / 2, -height / 2);
  return canvas;
};

export interface RotationExtractionResult {
  success: boolean;
  payload?: ChainedPayload;
  details?: ExtractionResult;
  rotation?: number;
  criticalMetadata?: ReturnType<typeof tryExtractDCT>['metadata'];
  error?: string;
}

type ExtractableSource = File | HTMLCanvasElement | HTMLImageElement;

export const tryExtractWithRotations = async (
  source: ExtractableSource,
  rotations: number[] = DEFAULT_ROTATIONS,
): Promise<RotationExtractionResult> => {
  let baseCanvas: HTMLCanvasElement;
  try {
    if (source instanceof HTMLCanvasElement) {
      baseCanvas = source;
    } else {
      const renderResult = await renderCanvasFromImage(source);
      baseCanvas = renderResult.canvas;
    }
  } catch (error) {
    return {
      success: false,
      error: `Failed to load image: ${error instanceof Error ? error.message : String(error)}`,
    };
  }

  let lastCriticalMetadata: RotationExtractionResult['criticalMetadata'];
  let metadataRotation: number | undefined;
  let lastError: string | undefined;
  const extractionErrors: string[] = [];

  // Try extraction at each rotation angle
  // Start with 0 degrees (no rotation) as it's most common
  const sortedRotations = [...rotations].sort((a, b) => {
    const normA = ((a % 360) + 360) % 360;
    const normB = ((b % 360) + 360) % 360;
    if (normA === 0) return -1;
    if (normB === 0) return 1;
    return normA - normB;
  });

  for (const rotation of sortedRotations) {
    let candidate: HTMLCanvasElement;
    try {
      // Normalize rotation to 0-360 range for comparison
      const normalizedRotation = ((rotation % 360) + 360) % 360;
      candidate = normalizedRotation === 0 ? baseCanvas : rotateCanvas(baseCanvas, rotation);
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      extractionErrors.push(`Rotation ${rotation}°: ${errMsg}`);
      lastError = errMsg;
      continue;
    }

    try {
      // Try extracting payload with details
      const details = await extractPayloadWithDetails(candidate);
      
      // If we found a full payload, return immediately
      if (details.payload) {
        return {
          success: true,
          payload: details.payload,
          details,
          rotation: normalizedRotation === 0 ? 0 : rotation,
          criticalMetadata: details.criticalMetadata ?? undefined,
        };
      }

      // If we found critical metadata, store it as fallback
      if (details.criticalMetadata) {
        lastCriticalMetadata = details.criticalMetadata;
        if (metadataRotation === undefined) {
          metadataRotation = normalizedRotation === 0 ? 0 : rotation;
        }
      } else {
        // Try DCT extraction as additional fallback
        try {
          const dctFallback = tryExtractDCT(candidate);
          if (dctFallback.success && dctFallback.metadata) {
            lastCriticalMetadata = dctFallback.metadata;
            if (metadataRotation === undefined) {
              metadataRotation = normalizedRotation === 0 ? 0 : rotation;
            }
          }
        } catch (dctError) {
          // DCT extraction failed, continue
        }
      }
      
      // Only set error if we haven't found anything yet
      if (!lastCriticalMetadata) {
        lastError = 'payload_not_found';
      }
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      extractionErrors.push(`Extraction at ${rotation}°: ${errMsg}`);
      // Only update error if we haven't found critical metadata
      if (!lastCriticalMetadata) {
        lastError = errMsg;
      }
    }
  }

  // If we found critical metadata but not full payload, return partial success
  if (lastCriticalMetadata) {
    return {
      success: false,
      rotation: metadataRotation,
      criticalMetadata: lastCriticalMetadata,
      error: 'Full payload not found, but critical metadata recovered. Image may have been re-encoded or heavily edited.',
    };
  }

  // No payload or metadata found
  const errorDetails = extractionErrors.length > 0 
    ? ` Errors: ${extractionErrors.slice(0, 3).join('; ')}${extractionErrors.length > 3 ? '...' : ''}`
    : '';
  return {
    success: false,
    rotation: metadataRotation,
    criticalMetadata: lastCriticalMetadata ?? undefined,
    error: `Unable to extract ImageChain data from this image.${errorDetails} The image may not contain ImageChain data, or the watermark may have been corrupted by rotation, re-encoding, or heavy editing.`,
  };
};
