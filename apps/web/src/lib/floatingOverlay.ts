const EMOJI_TOKEN_REGEX =
  /(?:[#*0-9]\uFE0F?\u20E3|\p{Regional_Indicator}{2}|\p{Extended_Pictographic}(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})?(?:\u200D\p{Extended_Pictographic}(?:\uFE0F|\uFE0E|\p{Emoji_Modifier})?)*)/gu;

/**
 * Returns true when a chat message consists strictly of 1–6 emojis (and optional whitespace),
 * so fullscreen/theater overlays can float it like an expressive reaction burst.
 */
export function isEmojiOnlyMessage(rawText: string): boolean {
  const trimmed = rawText.trim();
  if (!trimmed) return false;

  const matches = trimmed.match(EMOJI_TOKEN_REGEX);
  if (!matches || matches.length === 0 || matches.length > 6) {
    return false;
  }

  const remainder = trimmed.replace(EMOJI_TOKEN_REGEX, '').replace(/\s+/g, '');
  return remainder.length === 0;
}

/**
 * Computes how long a floating message bubble stays visible on screen based on length.
 */
export function computeFloatingChatLifetimeMs(rawText: string): number {
  const text = rawText.trim();
  if (isEmojiOnlyMessage(text)) {
    return 2800;
  }
  if (text.length <= 45) {
    return 5200;
  }
  return Math.min(8000, 4600 + text.length * 28);
}
