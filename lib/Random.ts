const UNMISTAKABLE_CHARS =
  '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';

const generators: Record<number, () => string> = Object.create(null);
let isSecureRandomEndabled: boolean | undefined;

const Random = {
  /**
   * Generates a random id-string of given length.
   * The string will consist of characters from the following list:
   * `23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz`
   * @param count {number} length of the id
   * @returns {string} the generated id string
   */
  id(count = 17): string {
    if (!isSecureRandomEndabled) {
      if (hasSecureRandom()) {
        isSecureRandomEndabled = true;
      } else {
        // Fall back to non-crypto RNG so tests and non‑RN envs don't crash.
        // We still generate unbiased IDs via rejection sampling over Math.random bytes.
        // Consumers that need strong RNG should provide a crypto implementation.
        // eslint-disable-next-line no-console
        console.warn(
          '@meteorrn/core: secure random generator not detected; falling back to non‑crypto RNG for Random.id().'
        );
        isSecureRandomEndabled = true;
      }
    }
    if (!generators[count]) {
      generators[count] = makeGenerator(count);
    }
    return generators[count]!();
  },
};

function hasSecureRandom(): boolean {
  // Web Crypto
  if (
    typeof (globalThis as any).crypto !== 'undefined' &&
    typeof (globalThis as any).crypto.getRandomValues === 'function'
  ) {
    return true;
  }
  // React Native quick-crypto
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rnCrypto = require('react-native-quick-crypto');
    if (rnCrypto?.webcrypto?.getRandomValues) return true;
    if (typeof rnCrypto?.randomFillSync === 'function') return true;
    if (typeof rnCrypto?.randomBytes === 'function') return true;
  } catch (_) {
    // ignore
  }
  // Node crypto
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    if (typeof nodeCrypto.randomFillSync === 'function') return true;
    if (
      nodeCrypto.webcrypto &&
      typeof nodeCrypto.webcrypto.getRandomValues === 'function'
    )
      return true;
  } catch (_) {
    // ignore
  }
  return false;
}

export default Random;

function makeGenerator(len: number) {
  const alphabet = UNMISTAKABLE_CHARS;
  const alphabetLen = alphabet.length;
  // Bitmask for the next power-of-two minus 1, covering alphabet length
  const mask = (2 << Math.floor(Math.log2(alphabetLen - 1))) - 1;
  // Number of random bytes to request per iteration (heuristic from nanoid)
  const step = Math.ceil((1.6 * mask * len) / alphabetLen);

  return function gen() {
    let out = '';
    while (out.length < len) {
      const bytes = new Uint8Array(step);
      getRandomValuesSafe(bytes);
      for (let i = 0; i < bytes.length; i++) {
        const idx = bytes[i]! & mask;
        if (idx < alphabetLen) {
          out += alphabet.charAt(idx);
          if (out.length === len) return out;
        }
      }
    }
    return out;
  };
}

function getRandomValuesSafe(buf: Uint8Array) {
  // Prefer Web Crypto if available (browser/modern Node)
  const cryptoAny: any = (globalThis as any).crypto;
  if (cryptoAny && typeof cryptoAny.getRandomValues === 'function') {
    return cryptoAny.getRandomValues(buf);
  }
  // React Native quick-crypto first (explicit)
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const rnCrypto = require('react-native-quick-crypto');
    if (rnCrypto?.webcrypto?.getRandomValues) {
      return rnCrypto.webcrypto.getRandomValues(buf);
    }
    if (typeof rnCrypto?.randomFillSync === 'function') {
      return rnCrypto.randomFillSync(buf);
    }
    if (typeof rnCrypto?.randomBytes === 'function') {
      const bytes = rnCrypto.randomBytes(buf.length);
      for (let i = 0; i < buf.length; i++) buf[i] = bytes[i];
      return buf;
    }
  } catch (_) {
    // ignore
  }
  // Fallback to Node crypto
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const nodeCrypto = require('crypto');
    if (typeof nodeCrypto.randomFillSync === 'function') {
      return nodeCrypto.randomFillSync(buf);
    }
    if (
      nodeCrypto.webcrypto &&
      typeof nodeCrypto.webcrypto.getRandomValues === 'function'
    ) {
      return nodeCrypto.webcrypto.getRandomValues(buf);
    }
  } catch (_) {
    // ignore
  }
  // As a last resort (should not happen in CI), fill with Math.random
  // to avoid hard failures in non-crypto test environments.
  for (let i = 0; i < buf.length; i++) {
    buf[i] = Math.floor(Math.random() * 256) & 0xff;
  }
  return buf;
}
