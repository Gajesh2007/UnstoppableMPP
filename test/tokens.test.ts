import { describe, test, expect } from 'bun:test'
import {
  estimateTokens,
  estimateInputTokensFromMessages,
  estimateEmbeddingTokens,
} from '../src/utils/tokens'

describe('estimateTokens', () => {
  test('empty string = 0 tokens', () => {
    expect(estimateTokens('')).toBe(0)
  })

  test('4 chars = 1 token', () => {
    expect(estimateTokens('abcd')).toBe(1)
  })

  test('5 chars = 2 tokens (rounds up)', () => {
    expect(estimateTokens('abcde')).toBe(2)
  })

  test('100 chars ~ 25 tokens', () => {
    expect(estimateTokens('a'.repeat(100))).toBe(25)
  })
})

describe('estimateInputTokensFromMessages', () => {
  test('single short message', () => {
    const tokens = estimateInputTokensFromMessages([
      { role: 'user', content: 'hello' },
    ])
    // 16 overhead + 5 chars = 21 chars / 4 = 6 tokens
    expect(tokens).toBe(6)
  })

  test('multiple messages accumulate', () => {
    const tokens = estimateInputTokensFromMessages([
      { role: 'system', content: 'You are helpful.' },
      { role: 'user', content: 'Hi there' },
    ])
    // (16 + 16) overhead + (16 + 8) content = 56 chars / 4 = 14
    expect(tokens).toBe(14)
  })

  test('handles null content', () => {
    const tokens = estimateInputTokensFromMessages([
      { role: 'assistant', content: null },
    ])
    // 16 overhead only = 4 tokens
    expect(tokens).toBe(4)
  })

  test('handles multimodal array content', () => {
    const tokens = estimateInputTokensFromMessages([
      {
        role: 'user',
        content: [
          { type: 'text', text: 'What is this?' },
          { type: 'image_url', image_url: { url: 'data:...' } },
        ],
      },
    ])
    // 16 overhead + 13 text chars = 29 / 4 = 8
    expect(tokens).toBe(8)
  })

  test('empty messages array', () => {
    expect(estimateInputTokensFromMessages([])).toBe(0)
  })
})

describe('estimateEmbeddingTokens', () => {
  test('single string input', () => {
    expect(estimateEmbeddingTokens('hello world')).toBe(3)
  })

  test('array of strings', () => {
    expect(estimateEmbeddingTokens(['hello', 'world'])).toBe(4) // ceil(5/4) + ceil(5/4) = 2 + 2
  })

  test('empty string', () => {
    expect(estimateEmbeddingTokens('')).toBe(0)
  })
})
