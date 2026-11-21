import { describe, expect, it } from 'vitest';
import { computeFloatingChatLifetimeMs, isEmojiOnlyMessage } from './floatingOverlay.js';

describe('isEmojiOnlyMessage', () => {
  it('accepts single and small groups of emojis including ZWJ, flag, and keycap sequences', () => {
    expect(isEmojiOnlyMessage('😂')).toBe(true);
    expect(isEmojiOnlyMessage('  🔥 ❤️ 🍿  ')).toBe(true);
    expect(isEmojiOnlyMessage('👨‍👩‍👧‍👦')).toBe(true);
    expect(isEmojiOnlyMessage('🇬🇧')).toBe(true);
    expect(isEmojiOnlyMessage('1️⃣')).toBe(true);
    expect(isEmojiOnlyMessage('😂😂😂🔥🔥🔥')).toBe(true);
  });

  it('rejects empty text, words, plain numbers, mixed messages, and walls of > 6 emojis', () => {
    expect(isEmojiOnlyMessage('')).toBe(false);
    expect(isEmojiOnlyMessage('   ')).toBe(false);
    expect(isEmojiOnlyMessage('Hello everyone')).toBe(false);
    expect(isEmojiOnlyMessage('no way 😱')).toBe(false);
    expect(isEmojiOnlyMessage('😂!')).toBe(false);
    expect(isEmojiOnlyMessage('123')).toBe(false);
    expect(isEmojiOnlyMessage('😂🔥❤️😱👏🍿🎉')).toBe(false);
  });
});

describe('computeFloatingChatLifetimeMs', () => {
  it('scales display duration within expected bounds by message type and length', () => {
    expect(computeFloatingChatLifetimeMs('🔥')).toBe(2800);
    expect(computeFloatingChatLifetimeMs('Great scene!')).toBe(5200);
    expect(computeFloatingChatLifetimeMs('a'.repeat(45))).toBe(5200);

    const medium = computeFloatingChatLifetimeMs('a'.repeat(80));
    expect(medium).toBe(4600 + 80 * 28);

    expect(computeFloatingChatLifetimeMs('a'.repeat(300))).toBe(8000);
  });
});
