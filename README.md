# 🛡️ AgentGuard for OpenClaw

**Know what your lobster did. Stop it before it does something you'll regret.**

AgentGuard is an oversight skill for [OpenClaw](https://openclaw.ai) that intercepts every sensitive action OpenClaw takes, scores its risk in real time, and sends you a Telegram alert with one-tap Approve or Deny buttons — before the action executes.

---

## The Problem

OpenClaw is powerful. It has access to your email, calendar, files, money, and external services. It runs while you sleep.

One user had their OpenClaw accidentally start a fight with their insurance company. Another gave it their credit card. These aren't bugs — they're features of a system with real autonomy over real things.

**AgentGuard is the safety net.**

---

## How It Works

AgentGuard runs a lightweight local server alongside your OpenClaw gateway. The `SKILL.md` teaches OpenClaw to check in with that server before taking any sensitive action. Every action gets risk scored and you get notified instantly on Telegram.

### Decision Table

| Score | Decision | What Happens |
|-------|----------|--------------|
| 1–4   | ✅ PASS  | Action proceeds automatically |
| 5–6   | ⚠️ FLAG  | Proceeds, but you get a Telegram alert |
| 7–8   | ⏳ AWAIT | OpenClaw pauses, you get Approve/Deny buttons |
| 9–10  | 🚫 BLOCK | Action is stopped, you get a Telegram alert |

### What Gets Logged

OpenClaw checks in before:
- 📧 Sending emails or messages
- 💸 Payments, transfers, financial transactions
- 🗑️ Deleting files, emails, or data
- 📢 Publishing content publicly
- 📅 Modifying calendar events
- 🔧 Installing software or running scripts
- 🔐 Handling credentials or API keys
- 🌐 Calling external APIs with your credentials

Safe actions like reading files, searching the web, and drafting content are **not** logged.

---

## Installation

### Step 1 — Install the skill

**Via ClawdHub:**
```bash
clawdhub install agentguard
```

**Or manually:**
```bash
# Clone this repo
git clone https://github.com/yourusername/agentguard-skill.git

# Copy the skill into your OpenClaw skills directory
cp -r agentguard-skill/skill ~/.openclaw/skills/agentguard
```

### Step 2 — Set up your Telegram bot

You need a Telegram bot to receive alerts. Takes 2 minutes.

1. Open Telegram and search for `@BotFather`
2. Send `/newbot` and follow the prompts
3. Copy the token BotFather gives you (looks like `7483920481:AAHxxx...`)
4. Search for your new bot in Telegram and press **Start**
5. Search for `@userinfobot`, start it, send any message — copy your chat ID number

### Step 3 — Configure the server
```bash
cd agentguard-skill/server
cp .env.example .env
```

Open `.env` and fill in your values:
```env
PORT=3456
NODE_ENV=development
TELEGRAM_BOT_TOKEN=your_token_from_botfather
TELEGRAM_CHAT_ID=your_chat_id_from_userinfobot
```

### Step 4 — Start the server
```bash
npm install
node index.js
```

You should see:
```
📱 Telegram bot connected

╔══════════════════════════════════════════╗
║   AgentGuard for OpenClaw                ║
║   Listening on http://localhost:3456     ║
║                                          ║
║   Your lobster is now accountable. 🛡️   ║
╚══════════════════════════════════════════╝
```

### Step 5 — Restart your OpenClaw session

Skills load when a session starts. Restart your agent and OpenClaw will now log sensitive actions automatically.

---

## Folder Structure
```
agentguard-skill/
├── skill/
│   └── SKILL.md          ← OpenClaw reads this, teaches OpenClaw to check in
├── server/
│   ├── index.js          ← Local oversight server
│   ├── package.json
│   ├── .env.example      ← Copy to .env and fill in your tokens
│   └── .env              ← Your secrets (never committed to git)
└── README.md
```

---

## Usage

### Approving actions

When OpenClaw hits an action that needs approval, you get a Telegram message like this:
```
⏳ AgentGuard — Approval Required

OpenClaw wants to:
Sending weekly newsletter to subscribers

Domain: communication
Risk score: 7/10
Cannot be undone ⚠️

Factors: Action cannot be undone, Sensitive domain: communication

[✅ Approve]  [🚫 Deny]
```

Tap **Approve** to let OpenClaw proceed. Tap **Deny** to stop it. The message updates instantly.

### Checking the audit log

Ask OpenClaw directly:
> "What have you done today?"

OpenClaw will call the `/summary` endpoint and give you a plain-English rundown.

Or check it yourself:
```bash
curl http://localhost:3456/log
```

### Running without Telegram

If you skip the Telegram setup, AgentGuard runs in local-only mode. All decisions are still made and logged — you just won't get phone alerts. You can still approve/deny via the API:
```bash
# Approve
curl -X POST http://localhost:3456/approval/<id>/approve

# Deny
curl -X POST http://localhost:3456/approval/<id>/deny
```

---

## How the Risk Score Works

Every action is scored 1–10 based on:

- **Reversibility** — irreversible actions score higher
- **Domain** — finance (+4), healthcare (+3), authentication (+3), filesystem (+2), communication (+2)
- **Pattern matching** — delete/remove/destroy (+2), payment/transfer (+2), credentials (+2), send/publish (+1)

The score determines the decision. You can run the server in debug mode to see the scoring breakdown for every action.

---

## Running as a Background Service

For production use, run the server as a background process so it survives terminal closes.

**On macOS/Linux with pm2:**
```bash
npm install -g pm2
pm2 start index.js --name agentguard
pm2 startup  # auto-start on reboot
```

**On Windows with pm2:**
```bash
npm install -g pm2
pm2 start index.js --name agentguard
pm2-startup install
```

---

## Roadmap

- [x] Risk scoring and decision engine
- [x] Telegram alerts for flagged and blocked actions
- [x] Approve/Deny buttons in Telegram
- [x] Full audit log endpoint
- [x] Local-only mode (no Telegram required)
- [ ] WhatsApp support
- [ ] Daily digest sent to your chat each morning
- [ ] Per-action policy rules ("always block payments over $100")
- [ ] LLM-based classifier for better accuracy
- [ ] Cloud sync for audit logs across devices
- [ ] Dashboard UI

---

## Contributing

PRs welcome. If you find an action that should be blocked but isn't, or one that's being incorrectly flagged, open an issue with the action details and we'll tune the scorer.

---

## Security

- Your bot token lives in `.env` and is never committed to git
- The server runs locally — no data leaves your machine
- Each user runs their own bot — no shared infrastructure
- Treat your bot token like a password — don't share it

---

Built for the OpenClaw community. Not affiliated with OpenClaw or Anthropic.

Issues and PRs welcome on GitHub.