# Gemini Live to OpenAI Adapter

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D20.0.0-green.svg)

A lightweight Express.js server that provides an OpenAI-compatible API interface for Google's Gemini Live API with native audio, enabling seamless integration with existing OpenAI SDKs and tools. Supports both text transcription and audio output responses.

## Table of Contents

- [Features](#features)
- [Prerequisites](#prerequisites)
- [Installation](#installation)
- [Usage](#usage)
- [API Reference](#api-reference)
- [Examples](#examples)
- [Deployment](#deployment)
- [Architecture](#architecture)
- [Contributing](#contributing)
- [License](#license)

## Features

- **OpenAI Compatibility**: Drop-in replacement for OpenAI API clients
- **Native Audio**: Uses Gemini's native audio model for natural, human-like speech
- **Audio Output**: OpenAI-compatible audio responses with `message.audio` (base64 WAV + transcript)
- **Text Fallback**: When audio is not requested, returns transcription as standard `message.content`
- **Voice Selection**: 30 HD voices via the `audio.voice` parameter
- **Streaming Support**: Real-time streaming and non-streaming responses
- **Stateless Design**: WebSocket connections open/close per request for high throughput
- **High Throughput**: Leverages Gemini Live API's higher rate limits (1M TPM vs OpenAI's 250k TPM)
- **Security**: IP-based access control and reverse proxy support
- **Health Check**: Built-in `/health` endpoint for monitoring
- **Docker Support**: Ready-to-deploy containerized solution

## Prerequisites

- Node.js >= 20.0.0
- A valid Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) (provided by clients in Authorization header)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/manuel-materazzo/gemini-live-to-openai-adapter.git
   cd gemini-live-to-openai-adapter
   ```

2. Install dependencies:
   ```bash
   npm install
   ```

### Optional Configuration

The server supports additional environment variables:

- `PORT`: Server port (default: 3000)
- `ALLOWED_IPS`: Comma-separated list of allowed IP addresses for access control
- `TRUSTED_PROXY_IPS`: Comma-separated list of trusted proxy IPs
- `REVERSE_PROXY_MODE`: Enable reverse proxy mode (true/false)
- `CORS_ORIGIN`: Comma-separated list of allowed CORS origins (CORS disabled if not set)
- `JSON_LIMIT`: Maximum JSON body size (default: 256kb)
- `REQUEST_TIMEOUT_MS`: Request timeout in milliseconds (default: 60000)

## Usage

### Development

Start the server with auto-reload for development:
```bash
npm run dev
```

### Production

Start the server:
```bash
npm start
```

The server will be available at `http://localhost:3000` (or your configured PORT).

## API Reference

### Endpoints

- `POST /v1/chat/completions`: Main chat completion endpoint (OpenAI-compatible)
- `GET /health`: Health check endpoint

### Supported Parameters

| Parameter | Type | Description |
|-----------|------|-------------|
| `model` | string | Gemini model name (default: `gemini-2.5-flash-native-audio-preview-12-2025`) |
| `messages` | array | Array of message objects with `role` and `content` |
| `stream` | boolean | Enable streaming responses |
| `temperature` | number | Controls randomness (0-2) |
| `max_tokens` | number | Maximum tokens in response |
| `modalities` | array | Output modalities: `["text"]` (default) or `["text", "audio"]` |
| `audio.voice` | string | Voice name for audio output (e.g., `Kore`, `Puck`, `Charon`) |
| `audio.format` | string | Audio format: `wav` (default) or `pcm16` |

### Response Modes

| Request `modalities` | Response format |
|---|---|
| Not set / `["text"]` | Standard `message.content` with transcription text |
| `["text", "audio"]` or `["audio"]` | `message.audio.data` (base64 WAV) + `message.audio.transcript` |

## Examples

### Using curl

**Text response (default):**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_gemini_api_key_here" \
  -d '{
    "model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "messages": [
      {"role": "user", "content": "What is RAG in AI?"}
    ]
  }'
```

**Audio + text response:**
```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_gemini_api_key_here" \
  -d '{
    "model": "gemini-2.5-flash-native-audio-preview-12-2025",
    "modalities": ["text", "audio"],
    "audio": {"voice": "Kore", "format": "wav"},
    "messages": [
      {"role": "user", "content": "What is RAG in AI?"}
    ]
  }'
```

### Using OpenAI Python SDK

```python
from openai import OpenAI

client = OpenAI(
    api_key="your_gemini_api_key_here",
    base_url="http://localhost:3000/v1"
)

response = client.chat.completions.create(
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    messages=[
        {"role": "user", "content": "Explain retrieval augmented generation"}
    ]
)

print(response.choices[0].message.content)
```

### Using OpenAI Node.js SDK

```javascript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: 'your_gemini_api_key_here',
  baseURL: 'http://localhost:3000/v1'
});

const response = await openai.chat.completions.create({
  model: 'gemini-2.5-flash-native-audio-preview-12-2025',
  messages: [
    { role: 'user', content: 'What is RAG?' }
  ]
});

console.log(response.choices[0].message.content);
```

### Streaming Example

```python
from openai import OpenAI

client = OpenAI(
    api_key="your_gemini_api_key_here",
    base_url="http://localhost:3000/v1"
)

stream = client.chat.completions.create(
    model="gemini-2.5-flash-native-audio-preview-12-2025",
    messages=[{"role": "user", "content": "Count to 10"}],
    stream=True
)

for chunk in stream:
    if chunk.choices[0].delta.content:
        print(chunk.choices[0].delta.content, end='')
```

## Deployment

### Docker

Build and run with Docker:

```bash
# Build the image
docker build -t gemini-adapter .

# Run the container
docker run -p 3000:3000 --env-file .env gemini-adapter
```

Or use the prebuilt image:
```bash
# Pull the image
docker pull ghcr.io/manuel-materazzo/gemini-live-to-openai-adapter:latest

# Run the container
docker run -p 3000:3000 --env-file .env ghcr.io/manuel-materazzo/gemini-live-to-openai-adapter
```

### Docker Compose

Use the provided `docker-compose.yml`:

```bash
docker-compose up -d
```

## Architecture

The adapter follows a stateless, high-throughput design:

```mermaid
sequenceDiagram
    participant Client
    participant Express as Express Server
    participant WS as WebSocket
    participant Gemini as Gemini Live API

    Client->>Express: POST /v1/chat/completions
    Express->>WS: Open WebSocket connection
    WS->>Gemini: Send request
    Gemini-->>WS: Stream response
    WS-->>Express: Receive chunks
    Express-->>Client: Stream response chunks
    WS->>WS: Close connection
```

- **Client**: Any OpenAI-compatible client or SDK
- **Express Server**: Handles HTTP requests and manages WebSocket connections
- **WebSocket**: Stateless connection to Gemini Live API (opens/closes per request)
- **Gemini Live API**: Google's real-time AI model

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Make your changes and add tests
4. Run the server locally to ensure everything works
5. Submit a pull request

## License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.
