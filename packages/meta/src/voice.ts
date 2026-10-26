/**
 * Muse Voice Transcribe is realtime-only (WebSocket, PCM16 at 16 or 24 kHz).
 * Plan: ffmpeg converts a WhatsApp OGG/Opus voice note to 16 kHz mono PCM16, then we stream it
 * in push-to-talk mode and collect the final transcript. Languages include Tamil, Hindi and English.
 * TODO(day 6+): implement with the `ws` package once the session protocol is confirmed.
 */
export async function transcribeVoiceNote(_pcm16: Buffer, _language = "en"): Promise<string> {
  throw new Error("transcribeVoiceNote: not implemented yet");
}
