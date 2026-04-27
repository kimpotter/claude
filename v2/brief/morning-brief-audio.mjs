/**
 * ElevenLabs TTS — converts brief text to MP3
 * Reads: brief/brief-latest.json
 * Writes: brief/audio/YYYY-MM-DD.mp3
 */

import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

const ELEVENLABS_API_KEY = process.env.ELEVENLABS_API_KEY;
// Voice ID — "Rachel" is a clear, professional voice. Override via ELEVENLABS_VOICE_ID secret.
const VOICE_ID = process.env.ELEVENLABS_VOICE_ID ?? '21m00Tcm4TlvDq8ikWAM';

async function generateAudio() {
  const briefPath = join(__dirname, 'brief-latest.json');
  const brief = JSON.parse(readFileSync(briefPath, 'utf8'));
  const { text, date } = brief;

  console.log(`Generating audio for ${date} (${brief.wordCount} words)...`);

  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE_ID}`, {
    method: 'POST',
    headers: {
      'xi-api-key': ELEVENLABS_API_KEY,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      text,
      model_id: 'eleven_turbo_v2',
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.8,
        style: 0.2,
        use_speaker_boost: true,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`ElevenLabs API error ${res.status}: ${err}`);
  }

  const audioBuffer = Buffer.from(await res.arrayBuffer());

  const audioDir = join(__dirname, 'audio');
  mkdirSync(audioDir, { recursive: true });

  const outputPath = join(audioDir, `${date}.mp3`);
  writeFileSync(outputPath, audioBuffer);
  console.log(`Audio saved: brief/audio/${date}.mp3 (${(audioBuffer.length / 1024).toFixed(1)} KB)`);

  // Also save as latest.mp3 for easy RSS reference
  writeFileSync(join(audioDir, 'latest.mp3'), audioBuffer);

  // Append audio path to brief JSON for RSS step
  const updatedBrief = { ...brief, audioFile: `brief/audio/${date}.mp3` };
  writeFileSync(briefPath, JSON.stringify(updatedBrief, null, 2));

  return outputPath;
}

generateAudio().catch(err => {
  console.error('Audio generation failed:', err);
  process.exit(1);
});
