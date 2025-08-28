import { customAlphabet } from 'nanoid';

const UNMISTAKABLE_CHARS =
  '23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz';

const generators = Object.create(null);
let isSecureRandomEndabled;

module.exports = {
  /**
   * Generates a random id-string of given length.
   * The string will consist of characters from the following list:
   * `23456789ABCDEFGHJKLMNPQRSTWXYZabcdefghijkmnopqrstuvwxyz`
   * @param count {number} length of the id
   * @returns {string} the generated id string
   */
  id(count = 17) {
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
      generators[count] = customAlphabet(UNMISTAKABLE_CHARS, count);
    }
    return generators[count]();
  }
};

function hasSecureRandom() {
  return (
    typeof globalThis.crypto !== 'undefined' &&
    typeof globalThis.crypto.getRandomValues === 'function'
  );
}