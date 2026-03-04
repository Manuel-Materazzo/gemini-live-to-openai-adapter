// Configuration constants for the Gemini Live to OpenAI Adapter

export const DEFAULT_PORT = 3000;
export const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const SERVICE_NAME = 'gemini-live-openai-adapter';

// IP restriction configuration
export const ALLOWED_IPS = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];
export const TRUSTED_PROXY_IPS = process.env.TRUSTED_PROXY_IPS ? process.env.TRUSTED_PROXY_IPS.split(',').map(ip => ip.trim()) : [];
export const REVERSE_PROXY_MODE = process.env.REVERSE_PROXY_MODE === 'true';
