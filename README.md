# Travel Agent System

A multi-agent AI travel planning system where specialized agents collaborate to plan complete trips through natural conversation.

## What It Does

Ask the system to plan a trip and multiple AI agents work together:

- **Flight Agent** — searches and recommends flights
- **Hotel Agent** — finds accommodations matching your preferences
- **Activity Agent** — suggests activities and experiences
- **Itinerary Agent** — assembles everything into a coherent travel plan

## Tech Stack

| Layer           | Technology            |
| --------------- | --------------------- |
| Frontend        | React + Vite          |
| Backend         | Node.js + Express     |
| Agent Framework | LangGraph + LangChain |
| LLM Providers   | OpenAI + Anthropic    |
| Database        | MongoDB               |
| Validation      | Zod                   |

## Architecture

```
User Message
    ↓
Supervisor Agent (routes to specialists)
    ↓
┌─────────────────────────────────────┐
│  Flight Agent  │  Hotel Agent       │
│  Activity Agent │ Itinerary Agent   │
└─────────────────────────────────────┘
    ↓
Aggregated Response → User
```

## Quick Start

### Backend

```bash
cd backend
cp .env.example .env
# Add your OPENAI_API_KEY and ANTHROPIC_API_KEY
npm install
npm run dev
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Features

- Multi-agent orchestration with LangGraph StateGraph
- Persistent conversation memory per session
- Real-time streaming responses via SSE
- Tool-calling for search operations
- Graceful error handling and agent fallbacks

## Project Structure

```
travel-agent-system/
├── frontend/          # React UI with chat interface
├── backend/
│   └── src/
│       ├── agents/    # Specialized travel agents
│       ├── graph/     # LangGraph orchestration
│       ├── tools/     # Search & booking tools
│       ├── prompts/   # Agent prompt templates
│       └── db/        # MongoDB connection & models
├── data/              # Sample data for development
└── docs/              # Architecture documentation
```

## License

MIT
