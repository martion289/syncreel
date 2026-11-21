import { describe, expect, it } from 'vitest';
import { convertAssToVtt, convertSrtToVtt, convertToWebVtt } from '../subtitleConverter.js';

describe('subtitleConverter', () => {
  it('converts SRT with UTF-8 BOM, comma timestamps, and multi-line cues into WEBVTT', () => {
    const srt = [
      '\uFEFF1',
      '00:00:01,500 --> 00:00:04,200',
      'Welcome to the screening.',
      'Grab some popcorn!',
      '',
      '2',
      '0:01:12,05 --> 0:01:15,100',
      'Second cue.'
    ].join('\r\n');

    const vtt = convertSrtToVtt(srt);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);
    expect(vtt).toContain('00:00:01.500 --> 00:00:04.200\nWelcome to the screening.\nGrab some popcorn!');
    expect(vtt).toContain('00:01:12.050 --> 00:01:15.100\nSecond cue.');
  });

  it('converts ASS/SSA Dialogue lines, strips override tags, handles commas in text, and sorts cues', () => {
    const ass = [
      '[Script Info]',
      'Title: Sample',
      '',
      '[Events]',
      'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
      'Dialogue: 0,0:00:10.00,0:00:13.50,Default,,0,0,0,,{\\i1}Later, my friend!{\\i0}',
      'Dialogue: 0,0:00:02.25,0:00:05.00,Default,,0,0,0,,Line one\\NLine two'
    ].join('\n');

    const vtt = convertAssToVtt(ass);
    expect(vtt.startsWith('WEBVTT\n\n')).toBe(true);

    const firstCueIdx = vtt.indexOf('00:00:02.250 --> 00:00:05.000');
    const secondCueIdx = vtt.indexOf('00:00:10.000 --> 00:00:13.500');
    expect(firstCueIdx).toBeGreaterThan(-1);
    expect(secondCueIdx).toBeGreaterThan(firstCueIdx);
    expect(vtt).toContain('Line one\nLine two');
    expect(vtt).toContain('Later, my friend!');
    expect(vtt).not.toContain('{\\i1}');
  });

  it('passes through valid WEBVTT unchanged', () => {
    const raw = 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nHello\n';
    expect(convertToWebVtt(raw, 'vtt')).toBe(raw);
  });
});
