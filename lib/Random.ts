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
        throw new Error(
          '@meteorrn/core: crypto.getRandomValues is not available.\n' +
            'In React Native, add `import "react-native-get-random-values";` at the top of your entry file (index.js/ts).'
        );
      }
    }
    if (!generators[count]) {
      generators[count] = makeGenerator(count);
    }
    return generators[count]!();
  },
};

function hasSecureRandom(): boolean {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  );
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
      globalThis.crypto!.getRandomValues(bytes);
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
