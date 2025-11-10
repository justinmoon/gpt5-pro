import { get_encoding, type Tiktoken } from '@dqbd/tiktoken';

const ENCODING_NAME = 'cl100k_base';

let encoder: Tiktoken | null = null;

function getEncoder(): Tiktoken {
  if (!encoder) {
    encoder = get_encoding(ENCODING_NAME);
    process.once('exit', () => {
      encoder?.free();
      encoder = null;
    });
  }
  return encoder;
}

export function countTokens(text: string): number {
  const enc = getEncoder();
  return enc.encode(text).length;
}
