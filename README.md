# Gemini Live to OpenAI Adapter

![License](https://img.shields.io/badge/License-MIT-blue.svg)
![Node Version](https://img.shields.io/badge/node-%3E%3D14.0.0-green.svg)

A lightweight Express.js server that provides an OpenAI-compatible API interface for Google's Gemini Live API, enabling seamless integration with existing OpenAI SDKs and tools.

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
- **Streaming Support**: Real-time streaming and non-streaming responses
- **Stateless Design**: WebSocket connections open/close per request for high throughput
- **High Throughput**: Leverages Gemini Live API's higher rate limits (1M TPM vs OpenAI's 250k TPM)
- **Security**: IP-based access control and reverse proxy support
- **Health Check**: Built-in `/health` endpoint for monitoring
- **Docker Support**: Ready-to-deploy containerized solution

## Prerequisites

- Node.js >= 14.0.0
- A valid Google Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) (provided by clients in Authorization header)

## Installation

1. Clone the repository:
   ```bash
   git clone https://github.com/yourusername/gemini-live-to-openai-adapter.git
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
| `model` | string | Any OpenAI model name (maps to Gemini Live API) |
| `messages` | array | Array of message objects with `role` and `content` |
| `stream` | boolean | Enable streaming responses |
| `temperature` | number | Controls randomness (0-2) |
| `max_tokens` | number | Maximum tokens in response |

## Examples

### Using curl

```bash
curl http://localhost:3000/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer your_gemini_api_key_here" \
  -d '{
    "model": "gemini-live-2.5-flash-preview",
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
    model="gemini-live-2.5-flash-preview",
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
  model: 'gemini-live-2.5-flash-preview',
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
    model="gemini-live-2.5-flash-preview",
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
