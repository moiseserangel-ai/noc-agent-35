# NOC Agent 35

> A operação atual, validação de produção, backup, atualização e recuperação estão documentadas em [PRODUCTION_RUNBOOK.md](PRODUCTION_RUNBOOK.md).

**AI-powered autonomous NOC monitoring system** — Diagnose and remediate network/server incidents using Claude AI agents, with WhatsApp approval workflows and Zabbix integration.

![Node.js](https://img.shields.io/badge/Node.js-18+-339933?logo=nodedotjs&logoColor=white)
![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=black)
![Claude AI](https://img.shields.io/badge/Claude_AI-Anthropic-8B5CF6?logo=anthropic&logoColor=white)
![SQLite](https://img.shields.io/badge/SQLite-Prisma-003B57?logo=sqlite&logoColor=white)
![License](https://img.shields.io/badge/License-MIT-blue)

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Features](#features)
- [Requirements](#requirements)
- [Installation](#installation)
- [Configuration](#configuration)
- [Database Setup](#database-setup)
- [Running the Application](#running-the-application)
- [Production Deployment (PM2)](#production-deployment-pm2)
- [Integrations](#integrations)
- [API Endpoints](#api-endpoints)
- [Project Structure](#project-structure)
- [Security](#security)
- [Troubleshooting](#troubleshooting)
- [License](#license)

---

## Overview

NOC Agent 35 is an intelligent Network Operations Center system that uses **multi-agent AI architecture** to autonomously diagnose and remediate infrastructure issues. It connects to your devices via SSH, analyzes problems using Claude AI, and sends diagnostic reports to administrators via WhatsApp for approval before applying fixes.

### How it works

```
Alert (Zabbix/WhatsApp) -> Support Agent (Router) -> Specialist Agent -> SSH Diagnosis -> WhatsApp Approval -> Auto-Remediation
```

---

## Architecture

The system uses a **Multi-Agent Pipeline** with Claude's Native Tool Use (Function Calling):

```
+-----------------------------------------------------------+
|                      Entry Points                         |
|  +----------+  +--------------+  +----------------+      |
|  | WhatsApp |  |Zabbix Webhook|  | Web Dashboard  |      |
|  |(Evolution)|  |              |  |  (React SPA)   |      |
|  +----+-----+  +------+-------+  +-------+--------+      |
|       |               |                  |                |
|       +---------------+------------------+                |
|                       |                                   |
|            +----------v----------+                        |
|            | Support Agent       |  Classifier/Router     |
|            |  search_device      |                        |
|            |  list_devices       |                        |
|            +----------+----------+                        |
|                       |                                   |
|           +-----------+-----------+                       |
|           |                       |                       |
|    +------v-------+     +--------v-----+                  |
|    | MikroTik     |     | Linux        |                  |
|    | Agent        |     | Agent        |                  |
|    | ssh_mikrotik |     | ssh_linux    |                  |
|    | ping/trace   |     | ping/trace   |                  |
|    +--------------+     +--------------+                  |
|           |                       |                       |
|           +-----------+-----------+                       |
|                       |                                   |
|            +----------v---------+                         |
|            |  SSH -> Devices    |                         |
|            | (RouterOS/Linux)   |                         |
|            +--------------------+                         |
+-----------------------------------------------------------+
```

| Agent | Role | Tools |
|-------|------|-------|
| **Support Agent** | Classifier & Router | `search_device`, `list_devices` |
| **MikroTik Agent** | Network specialist - RouterOS | `ssh_mikrotik_exec`, `ping_host`, `traceroute_host` |
| **Linux Agent** | Server specialist | `ssh_linux_exec`, `ping_host`, `traceroute_host` |

---

## Features

- **Multi-provider AI System** - Claude, OpenAI e Gemini com fallback configurável
- **WhatsApp Integration** - Receive alerts and approve actions via WhatsApp (Evolution API)
- **Zabbix Integration** - Automatic alert processing from Zabbix webhooks
- **Real-time Dashboard** - React SPA with live AI streaming via Socket.IO
- **SSH Access** - Secure remote access to MikroTik and Linux devices
- **AES-256-GCM Encryption** - All credentials encrypted at rest
- **Approval Workflow** - Human-in-the-loop approval before applying changes
- **Task Tracking** - Full history of diagnostics, approvals, and executions
- **Streaming Responses** - Real-time AI response streaming in the dashboard
- **Professional incident workflow** - SLA, escalation, assignment, validation and audit trail
- **Role-based access and 2FA** - Administrador, Operador, Visualização e sessões revogáveis
- **Reports and backups** - MTTA/MTTR/SLA, CSV, backup automático e restauração validada

---

## Requirements

| Requirement | Version |
|-------------|---------|
| **Node.js** | >= 18.x |
| **npm** | >= 9.x |
| **Git** | >= 2.x |
| **OS** | Ubuntu 20.04+ / Debian 11+ (recommended) |

### External Services

| Service | Purpose | Required? |
|---------|---------|-----------|
| **Anthropic API Key** | Claude AI for agent intelligence | Yes |
| **Evolution API** | WhatsApp messaging integration | Optional |
| **Zabbix** | Monitoring alert webhooks | Optional |

---

## Installation

### 1. Clone the repository

```bash
git clone https://github.com/clfigueiredo/noc-agent-35.git
cd noc-agent-35
```

### 2. Install backend dependencies

```bash
npm install
```

### 3. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

### 4. Create your environment file

```bash
cp .env.example .env
```

Edit `.env` with your actual values (see [Configuration](#configuration) below).

### 5. Setup the database

```bash
# Generate Prisma client
npm run db:generate

# Create/push the database schema
npm run db:push
```

### 6. Build the frontend

```bash
cd frontend
npm run build
cd ..
```

### 7. Start the application

```bash
# Development (with hot-reload)
npm run dev

# Production
npm start
```

Access the dashboard at: `http://localhost:3000`

---

## Configuration

Copy `.env.example` to `.env` and configure:

```env
# Server
PORT=3000
NODE_ENV=production

# Database - SQLite file path (relative to prisma/ directory)
DATABASE_URL="file:./data/noc-agent.db"

# Security (CHANGE THESE!)
# 64-char hex string for AES-256-GCM encryption of SSH passwords
ENCRYPTION_KEY=<generate-with: openssl rand -hex 32>
# Secret for JWT token signing
JWT_SECRET=<generate-with: openssl rand -base64 32>
# Password to login to the web dashboard
DASHBOARD_PASSWORD=<your-strong-password>

# Claude AI (Anthropic)
CLAUDE_API_KEY=sk-ant-xxxxxxxxxxxxxxxxxxxxx
CLAUDE_MODEL=claude-sonnet-4-20250514

# Evolution API (WhatsApp)
EVOLUTION_API_URL=http://localhost:8080
EVOLUTION_API_KEY=<your-evolution-api-key>
EVOLUTION_INSTANCE=noc-agent
ADMIN_WHATSAPP=5511999999999

# Zabbix
ZABBIX_WEBHOOK_TOKEN=<random-token-for-zabbix-webhook>
ZABBIX_URL=http://zabbix.example.com

# Authorization - Comma-separated WhatsApp numbers allowed to interact
AUTHORIZED_NUMBERS=5511999999999,5511888888888
```

### Generating Security Keys

```bash
# Generate ENCRYPTION_KEY (64-char hex)
openssl rand -hex 32

# Generate JWT_SECRET
openssl rand -base64 32
```

---

## Database Setup

NOC Agent 35 uses **SQLite** with **Prisma ORM** - no external database server needed!

### Schema Overview

| Model | Description |
|-------|-------------|
| `Device` | Network devices (MikroTik/Linux) with encrypted SSH credentials |
| `Task` | Diagnostic tasks with status tracking and approval workflow |
| `TaskMessage` | Messages exchanged during a task (user, agent, system) |
| `Settings` | Application settings stored in DB (API keys, etc.) |
| `ChatSession` | Dashboard chat sessions |
| `ChatMessage` | Messages in dashboard chat sessions |

### Database Commands

```bash
# Generate Prisma Client (after schema changes)
npm run db:generate

# Push schema to database (creates tables)
npm run db:push

# Seed initial data (if available)
npm run db:seed
```

### Database File Location

The SQLite database is stored at: `prisma/data/noc-agent.db`

> **Note:** This file is git-ignored. Each installation creates its own database.

### Resetting the Database

```bash
# Delete the database file
rm -f prisma/data/noc-agent.db

# Recreate it
npm run db:push
```

---

## Running the Application

### Development Mode

Run the backend and frontend separately for hot-reloading:

```bash
# Terminal 1: Backend (port 3000)
npm run dev

# Terminal 2: Frontend dev server (port 5173, proxies to backend)
cd frontend
npm run dev
```

### Production Mode

Build the frontend and run everything from a single process:

```bash
# Build frontend
cd frontend && npm run build && cd ..

# Start production server
npm start
```

The server serves the built frontend as static files from `frontend/dist/`.

---

## Production Deployment (PM2)

### Install PM2

```bash
npm install -g pm2
```

### Create ecosystem file

```bash
cat > ecosystem.config.cjs << 'EOF'
module.exports = {
  apps: [{
    name: 'noc-agent',
    script: 'src/server.js',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '500M',
    log_date_format: 'YYYY-MM-DD HH:mm:ss',
    error_file: 'logs/error.log',
    out_file: 'logs/out.log',
    merge_logs: true,
  }]
};
EOF
```

### Start with PM2

```bash
# Start
pm2 start ecosystem.config.cjs

# Save process list (auto-restart on reboot)
pm2 save

# Setup startup script
pm2 startup
```

### PM2 Useful Commands

```bash
pm2 logs noc-agent          # View logs
pm2 monit                   # Monitor CPU/RAM
pm2 restart noc-agent       # Restart
pm2 stop noc-agent          # Stop
pm2 list                    # List processes
```

---

## Integrations

### WhatsApp (Evolution API)

1. Install and configure [Evolution API](https://github.com/EvolutionAPI/evolution-api)
2. Set the webhook URL in Evolution API:
   ```
   POST http://<your-server>:3000/api/webhooks/evolution
   ```
3. Configure the environment variables:
   ```env
   EVOLUTION_API_URL=http://localhost:8080
   EVOLUTION_API_KEY=your-key
   EVOLUTION_INSTANCE=noc-agent
   ADMIN_WHATSAPP=5511999999999
   ```
4. The webhook is configured automatically via the Settings page in the dashboard.

### Zabbix

1. Create a **Webhook** media type in Zabbix:
   - **URL:** `http://<your-server>:3000/api/webhooks/zabbix`
   - **Method:** POST
   - **Headers:** `Content-Type: application/json`
2. Add the authentication token parameter:
   ```
   token = <your-ZABBIX_WEBHOOK_TOKEN>
   ```
3. Configure the webhook script to send alert data as JSON.
4. Full instructions are available in the dashboard under **Documentation**.

---

## API Endpoints

### Public

| Method | Endpoint | Description |
|--------|----------|-------------|
| `POST` | `/api/auth/login` | Authenticate and get JWT token |
| `POST` | `/api/webhooks/evolution` | Evolution API webhook receiver |
| `POST` | `/api/webhooks/zabbix` | Zabbix alert webhook receiver |
| `GET`  | `/api/health` | Health check |

### Protected (requires JWT)

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/devices` | List all devices |
| `POST` | `/api/devices` | Create a device |
| `PUT` | `/api/devices/:id` | Update a device |
| `DELETE` | `/api/devices/:id` | Delete a device |
| `GET` | `/api/tasks` | List all tasks |
| `GET` | `/api/tasks/:id` | Get task details |
| `GET` | `/api/settings` | Get application settings |
| `PUT` | `/api/settings` | Update settings |
| `GET` | `/api/chat/sessions` | List chat sessions |
| `POST` | `/api/chat/sessions` | Create chat session |
| `DELETE` | `/api/chat/sessions/:id` | Delete chat session |

### WebSocket Events (Socket.IO)

| Event | Direction | Description |
|-------|-----------|-------------|
| `chat:message` | Client -> Server | Send message to AI agent |
| `chat:chunk` | Server -> Client | Streaming text response chunk |
| `chat:tool` | Server -> Client | Tool execution status |
| `chat:typing` | Server -> Client | Agent is processing |
| `chat:complete` | Server -> Client | Response complete |
| `chat:error` | Server -> Client | Error occurred |

---

## Project Structure

```
noc-agent-35/
 prisma/
   ├── schema.prisma          # Database schema (SQLite)
   └── data/                  # SQLite database file (git-ignored)
 src/
 server.js              # Express server + Socket.IO   
   ├── config/
   │   └── index.js           # Environment configuration
   ├── agents/
   │   ├── base-agent.js      # Base agent class (Claude SDK wrapper)
   │   ├── support-agent.js   # Classifier/Router agent
   │   ├── mikrotik-agent.js  # MikroTik specialist agent
   │   └── linux-agent.js     # Linux specialist agent
   ├── tools/
   │   ├── ssh-mikrotik.tool.js  # RouterOS SSH execution
   │   ├── ssh-linux.tool.js     # Linux SSH execution
   │   └── network.tool.js       # Ping & Traceroute
   ├── services/
 device.service.js     # Device CRUD operations   │   
   │   ├── task.service.js       # Task management
   │   ├── evolution.service.js  # WhatsApp messaging
   │   └── zabbix.service.js     # Zabbix webhook handling
   ├── routes/
   │   ├── auth.routes.js        # Authentication endpoints
   │   ├── device.routes.js      # Device management
   │   ├── settings.routes.js    # Settings management
   │   ├── task.routes.js        # Task management
   │   ├── chat.routes.js        # Chat session management
   │   └── webhook.routes.js     # Webhook receivers
   ├── middleware/
 auth.middleware.js    # JWT authentication   │   ├
   └── error.middleware.js   # Error handling   
   ├── database/
   │   └── client.js            # Prisma client instance
   └── utils/
       ├── crypto.js            # AES-256-GCM encryption
       └── logger.js            # Winston logger
 frontend/
   ├── src/
   │   ├── App.jsx              # React app with routing
   │   ├── main.jsx             # Entry point
   │   ├── pages/
   │   │   ├── Dashboard.jsx    # Overview dashboard
   │   │   ├── Chat.jsx         # AI chat interface
   │   │   ├── Devices.jsx      # Device management
   │   │   ├── Tasks.jsx        # Task tracking
   │   │   ├── Settings.jsx     # App configuration
   │   │   ├── Docs.jsx         # Integration docs
   │   │   └── Login.jsx        # Authentication
   │   ├── components/
   │   │   ├── Layout.jsx       # App layout with sidebar
   │   │   ├── Modal.jsx        # Modal component
   │   │   └── StatusBadge.jsx  # Status indicator
   │   ├── lib/                 # Utilities & API client
   │   └── styles/              # CSS stylesheets
   ├── vite.config.js           # Vite configuration
   └── package.json
 .env.example                 # Environment template
 .gitignore
 package.json
 README.md
```

---

## Security

- **Credentials at Rest:** All SSH passwords and API keys stored in the database are encrypted with **AES-256-GCM**
- **JWT Authentication:** Dashboard and API access requires a valid JWT token
- **Dangerous Command Blocking:** SSH tools have built-in blocklists preventing destructive commands (`/system reset`, `rm -rf /`, etc.)
- **Approval Workflow:** High-risk operations require explicit human approval via WhatsApp
- **Authorized Numbers:** Only whitelisted phone numbers can interact via WhatsApp

### Important Security Notes

1. **Always change default credentials** in `.env` before deploying
2. Generate strong, unique values for `ENCRYPTION_KEY`, `JWT_SECRET`, and `DASHBOARD_PASSWORD`
3. Use HTTPS in production (reverse proxy with Nginx/Caddy)
4. Restrict firewall access to port 3000

---

## Troubleshooting

**Database errors after pulling updates:**

```bash
npm run db:generate
npm run db:push
```

**Cannot find module @prisma/client:**

```bash
npm install
npm run db:generate
```

**Frontend shows blank page:**

```bash
cd frontend && npm run build && cd ..
```

**SSH connection fails to devices:**

1. Verify device credentials in the Devices page
2. Check that SSH port (default 22) is reachable from the server
3. Test: `ssh -p <port> <user>@<hostname>`

**WhatsApp messages not being received:**

1. Check Evolution API is running and accessible
2. Verify webhook URL is configured correctly
3. Check `AUTHORIZED_NUMBERS` includes the sending number
4. Review logs: `pm2 logs noc-agent`

**Claude API errors:**

1. Verify `CLAUDE_API_KEY` is valid
2. Check API quota/billing at [console.anthropic.com](https://console.anthropic.com)
3. Ensure the model name in `CLAUDE_MODEL` is correct

---

## License

This project is licensed under the [MIT License](LICENSE).

---

## Contributing

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

---

Built with love for NOC teams that want to sleep better at night.
