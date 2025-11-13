import { SigScheme } from '../types';

type AlgorithmBundle = {
  keyGen: EcKeyGenParams | RsaHashedKeyGenParams;
  importParams: EcKeyImportParams | RsaHashedImportParams;
  signParams: RsaPssParams | EcdsaParams;
};

const subtleCrypto = (() => {
  const subtle = globalThis.crypto?.subtle ?? (globalThis.crypto as any)?.webkitSubtle;
  if (!subtle) {
    throw new Error('WebCrypto API is not available in this environment.');
  }
  return subtle;
})();

const algorithmBundle = (scheme: SigScheme): AlgorithmBundle => {
  if (scheme === SigScheme.RSA) {
    return {
      keyGen: {
        name: 'RSA-PSS',
        modulusLength: 3072,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      importParams: {
        name: 'RSA-PSS',
        hash: 'SHA-256',
      },
      signParams: {
        name: 'RSA-PSS',
        saltLength: 32,
      },
    };
  }
  return {
    keyGen: {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    importParams: {
      name: 'ECDSA',
      namedCurve: 'P-256',
    },
    signParams: {
      name: 'ECDSA',
      hash: 'SHA-256',
    },
  };
};

const PEM_PRIVATE_HEADER = '-----BEGIN PRIVATE KEY-----';
const PEM_PRIVATE_FOOTER = '-----END PRIVATE KEY-----';
const PEM_PUBLIC_HEADER = '-----BEGIN PUBLIC KEY-----';
const PEM_PUBLIC_FOOTER = '-----END PUBLIC KEY-----';

const toArrayBuffer = (pem: string, header: string, footer: string): ArrayBuffer => {
  const normalized = pem
    .trim()
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');
  if (!normalized.startsWith(header) || !normalized.includes(footer)) {
    throw new Error('Invalid PEM format.');
  }
  const base64 = normalized
    .replace(header, '')
    .replace(footer, '')
    .replace(/[\n\s]/g, '');
  const binary = atob(base64);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
};

const toPem = (buffer: ArrayBuffer, header: string, footer: string): string => {
  const base64 = arrayBufferToBase64(buffer).replace(/(.{64})/g, '$1\n');
  return `${header}\n${base64}\n${footer}\n`;
};

const arrayBufferToBase64 = (buffer: ArrayBuffer): string => {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i += 1) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
};

const bufferFromData = (data: ArrayBuffer | ArrayBufferView | string): ArrayBuffer => {
  if (typeof data === 'string') {
    return new TextEncoder().encode(data).buffer;
  }
  if (ArrayBuffer.isView(data)) {
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  }
  return data;
};

const canonicalize = (value: unknown): unknown => {
  if (Array.isArray(value)) {
    return value.map((entry) => canonicalize(entry));
  }
  if (value && typeof value === 'object') {
    const sortedKeys = Object.keys(value as Record<string, unknown>).sort();
    const result: Record<string, unknown> = {};
    for (const key of sortedKeys) {
      result[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return result;
  }
  return value;
};

const importPrivateKey = async (pem: string, scheme: SigScheme): Promise<CryptoKey> => {
  const bundle = algorithmBundle(scheme);
  const buffer = toArrayBuffer(pem, PEM_PRIVATE_HEADER, PEM_PRIVATE_FOOTER);
  return subtleCrypto.importKey('pkcs8', buffer, bundle.importParams, false, ['sign']);
};

const importPublicKey = async (pem: string, scheme: SigScheme): Promise<CryptoKey> => {
  const bundle = algorithmBundle(scheme);
  const buffer = toArrayBuffer(pem, PEM_PUBLIC_HEADER, PEM_PUBLIC_FOOTER);
  return subtleCrypto.importKey('spki', buffer, bundle.importParams, false, ['verify']);
};

export interface GeneratedKeyPair {
  scheme: SigScheme;
  privateKey: CryptoKey;
  publicKey: CryptoKey;
  privateKeyPem: string;
  publicKeyPem: string;
}

export const generateKeyPair = async (scheme: SigScheme): Promise<GeneratedKeyPair> => {
  const bundle = algorithmBundle(scheme);
  const { privateKey, publicKey } = (await subtleCrypto.generateKey(bundle.keyGen, true, [
    'sign',
    'verify',
  ])) as CryptoKeyPair;

  const [privateDer, publicDer] = await Promise.all([
    subtleCrypto.exportKey('pkcs8', privateKey),
    subtleCrypto.exportKey('spki', publicKey),
  ]);

  return {
    scheme,
    privateKey,
    publicKey,
    privateKeyPem: toPem(privateDer, PEM_PRIVATE_HEADER, PEM_PRIVATE_FOOTER),
    publicKeyPem: toPem(publicDer, PEM_PUBLIC_HEADER, PEM_PUBLIC_FOOTER),
  };
};

export const exportPublicKeyToPem = async (publicKey: CryptoKey): Promise<string> => {
  const spki = await subtleCrypto.exportKey('spki', publicKey);
  return toPem(spki, PEM_PUBLIC_HEADER, PEM_PUBLIC_FOOTER);
};

export const signPayload = async (
  payload: ArrayBuffer | ArrayBufferView | string,
  privateKeyPem: string,
  scheme: SigScheme,
): Promise<string> => {
  const bundle = algorithmBundle(scheme);
  const privateKey = await importPrivateKey(privateKeyPem, scheme);
  const dataBuffer = bufferFromData(payload);
  const signature = await subtleCrypto.sign(bundle.signParams, privateKey, dataBuffer);
  return arrayBufferToBase64(signature);
};

export const verifySignature = async (
  payload: ArrayBuffer | ArrayBufferView | string,
  signatureB64: string,
  publicKeyPem: string,
  scheme: SigScheme,
): Promise<boolean> => {
  try {
    const bundle = algorithmBundle(scheme);
    const publicKey = await importPublicKey(publicKeyPem, scheme);
    const dataBuffer = bufferFromData(payload);
    const signatureBytes = Uint8Array.from(atob(signatureB64), (c) => c.charCodeAt(0));
    return subtleCrypto.verify(bundle.signParams, publicKey, signatureBytes, dataBuffer);
  } catch (error) {
    console.error('Signature verification failed:', error);
    return false;
  }
};

export const sha256 = async (
  data: ArrayBuffer | ArrayBufferView | string,
): Promise<string> => {
  const buffer = bufferFromData(data);
  const hashBuffer = await subtleCrypto.digest('SHA-256', buffer);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
};

export const getPayloadHeader = (payload: Record<string, unknown>): string => {
  const copy = { ...payload };
  delete (copy as Record<string, unknown>).signature;
  const canonicalPayload = canonicalize(copy);
  return JSON.stringify(canonicalPayload);
};
