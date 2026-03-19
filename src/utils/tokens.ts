/**
 * Rough token estimation: ~4 characters per token for English text.
 * This is a fast heuristic — for precision, use js-tiktoken later.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

/**
 * Estimate input tokens from an OpenAI chat completions request body.
 */
export function estimateInputTokensFromMessages(
  messages: Array<{ role: string; content: string | null | Array<unknown> }>
): number {
  let totalChars = 0
  for (const msg of messages) {
    // Per-message overhead (~4 tokens for role + formatting)
    totalChars += 16
    if (typeof msg.content === 'string') {
      totalChars += msg.content.length
    } else if (Array.isArray(msg.content)) {
      // Multimodal content — estimate text parts only
      for (const part of msg.content) {
        if (typeof part === 'object' && part !== null && 'text' in part) {
          totalChars += String((part as { text: string }).text).length
        }
      }
    }
  }
  return Math.ceil(totalChars / 4)
}

/**
 * Estimate input tokens from an embeddings request body.
 */
export function estimateEmbeddingTokens(
  input: string | string[]
): number {
  if (typeof input === 'string') {
    return estimateTokens(input)
  }
  return input.reduce((sum, text) => sum + estimateTokens(text), 0)
}
