import dotenv from 'dotenv';
dotenv.config();

// Configuration constants for the Gemini Live to OpenAI Adapter

export const DEFAULT_PORT = 3000;
export const DEFAULT_MODEL = 'gemini-2.5-flash-native-audio-preview-12-2025';
export const SERVICE_NAME = 'gemini-live-openai-adapter';

// IP restriction configuration
export const ALLOWED_IPS = process.env.ALLOWED_IPS ? process.env.ALLOWED_IPS.split(',').map(ip => ip.trim()) : [];
export const TRUSTED_PROXY_IPS = process.env.TRUSTED_PROXY_IPS ? process.env.TRUSTED_PROXY_IPS.split(',').map(ip => ip.trim()) : [];
export const REVERSE_PROXY_MODE = process.env.REVERSE_PROXY_MODE === 'true';

// Token counting mode: 'estimate' (character heuristic), 'count_tokens' (Gemini API), 'off' (return 0)
const TOKEN_COUNT_MODE_RAW = (process.env.TOKEN_COUNT_MODE || 'estimate').toLowerCase();
export const TOKEN_COUNT_MODE = ['estimate', 'count_tokens', 'off'].includes(TOKEN_COUNT_MODE_RAW) ? TOKEN_COUNT_MODE_RAW : 'estimate';
