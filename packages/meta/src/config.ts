const env = (k: string, fallback?: string): string => {
  const v = process.env[k] ?? fallback;
  if (v === undefined) throw new Error(`Missing env var ${k}`);
  return v;
};

/** Read lazily so tests and the web build don't need secrets. */
export const config = {
  get metaApiKey() { return env("META_API_KEY"); },
  get metaApiBase() { return env("META_API_BASE", "https://api.meta.ai/v1"); },
  models: {
    get spark() { return env("MODEL_SPARK", "muse-spark-1.3"); },
    get wonder() { return env("MODEL_WONDER", "muse-wonder-1.0"); },
    get image() { return env("MODEL_IMAGE", "muse-image-1.0"); },
    get sam() { return env("MODEL_SAM", "sam-3.1"); },
    get transcribe() { return env("MODEL_TRANSCRIBE", "muse-voice-transcribe-1.0"); },
  },
  openWeight: {
    get baseURL() { return env("OPENWEIGHT_BASE_URL"); },
    get apiKey() { return env("OPENWEIGHT_API_KEY"); },
    get model() { return env("OPENWEIGHT_MODEL", "meta-models/muse-spark-open-1026"); },
  },
  graph: {
    get version() { return env("META_GRAPH_VERSION", "v24.0"); },
    get token() { return env("META_SYSTEM_USER_TOKEN"); },
  },
  whatsapp: {
    get phoneNumberId() { return env("WHATSAPP_PHONE_NUMBER_ID"); },
    get token() { return env("WHATSAPP_TOKEN"); },
    get appSecret() { return env("WHATSAPP_APP_SECRET"); },
  },
  get asrWs() { return env("META_ASR_WS", "wss://api.meta.ai/v1/asr/realtime"); },
};
