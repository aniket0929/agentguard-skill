/**
 * AgentGuard Local Server for OpenClaw
 *
 * Runs on localhost:3456 alongside your OpenClaw gateway.
 * OpenClaw logs every sensitive action here before executing it.
 * We score the risk, decide pass/flag/block/await, and send
 * real-time Telegram alerts with approve/deny buttons.
 *
 * Start it with: node index.js
 */

const express = require('express')
const cors = require('cors')
const TelegramBot = require('node-telegram-bot-api')
require('dotenv').config()

const app = express()
const PORT = process.env.PORT ?? 3456

// ── Telegram setup ─────────────────────────────────────────────

const TELEGRAM_TOKEN = process.env.TELEGRAM_BOT_TOKEN
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID

// Only initialize bot if credentials are provided
// Allows running in local-only mode without Telegram
let bot = null

if (TELEGRAM_TOKEN && TELEGRAM_CHAT_ID) {
  bot = new TelegramBot(TELEGRAM_TOKEN, { polling: true })
  console.log('📱 Telegram bot connected')

  /**
   * Handle button taps from the user.
   * When user taps Approve or Deny in Telegram,
   * this callback fires and updates the approval status.
   */
  bot.on('callback_query', async (query) => {
    const data = query.data  // e.g. "approve:ag_123" or "deny:ag_123"
    const [action, id] = data.split(':')

    const approval = pendingApprovals.get(id)

    if (!approval) {
      await bot.answerCallbackQuery(query.id, { text: 'This approval has expired.' })
      return
    }

    if (approval.status !== 'pending') {
      await bot.answerCallbackQuery(query.id, {
        text: `Already ${approval.status}.`
      })
      return
    }

    if (action === 'approve') {
      // Mark as approved
      approval.status = 'approved'
      approval.resolvedAt = new Date().toISOString()

      const entry = actionLog.find(e => e.id === id)
      if (entry) entry.outcome = 'approved'

      // Update the Telegram message to show approved state
      await bot.editMessageText(
        `✅ *Approved*\n\n${approval.description}\n\nOpenClaw will proceed.`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        }
      )

      await bot.answerCallbackQuery(query.id, { text: '✅ Approved' })
      console.log(`\n✅ [AgentGuard] APPROVED via Telegram: ${approval.action}`)

    } else if (action === 'deny') {
      // Mark as denied
      approval.status = 'denied'
      approval.resolvedAt = new Date().toISOString()

      const entry = actionLog.find(e => e.id === id)
      if (entry) entry.outcome = 'denied'

      // Update the Telegram message to show denied state
      await bot.editMessageText(
        `🚫 *Denied*\n\n${approval.description}\n\nOpenClaw has been stopped.`,
        {
          chat_id: query.message.chat.id,
          message_id: query.message.message_id,
          parse_mode: 'Markdown'
        }
      )

      await bot.answerCallbackQuery(query.id, { text: '🚫 Denied' })
      console.log(`\n🚫 [AgentGuard] DENIED via Telegram: ${approval.action}`)
    }
  })

} else {
  console.log('⚠️  No Telegram credentials found. Running in local-only mode.')
  console.log('   Add TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID to .env to enable alerts.')
}

app.use(express.json())
app.use(cors())

// ── In-memory stores ───────────────────────────────────────────

// All actions logged this session
const actionLog = []

// Pending approvals — actions awaiting user decision
const pendingApprovals = new Map()

// ── Risk scoring ───────────────────────────────────────────────

/**
 * Score the risk of an action on a scale of 1-10.
 * Combines domain risk, reversibility, and action patterns.
 */
function scoreRisk(action) {
  let score = 1
  const factors = []

  // Irreversible actions are inherently riskier
  if (action.reversible === false) {
    score += 3
    factors.push('Action cannot be undone')
  }

  // Domain-based risk
  const domainScores = {
    finance: 4,
    healthcare: 3,
    authentication: 3,
    filesystem: 2,
    communication: 2,
    web: 1,
    other: 0
  }

  const domainScore = domainScores[action.domain] ?? 0
  if (domainScore > 0) {
    score += domainScore
    factors.push(`Sensitive domain: ${action.domain}`)
  }

  // Pattern matching on action name and description
  const name = (action.action ?? '').toLowerCase()
  const desc = (action.description ?? '').toLowerCase()
  const combined = name + ' ' + desc

  if (/delete|remove|destroy|wipe|purge/.test(combined)) {
    score += 2
    factors.push('Destructive action detected')
  }

  if (/payment|transfer|charge|pay|invoice|bank/.test(combined)) {
    score += 2
    factors.push('Financial action detected')
  }

  if (/send|publish|post|broadcast|email|message/.test(combined)) {
    score += 1
    factors.push('External communication detected')
  }

  if (/password|secret|token|credential|key/.test(combined)) {
    score += 2
    factors.push('Credential handling detected')
  }

  return {
    score: Math.min(10, score),
    factors
  }
}

/**
 * Decide what to do based on risk score.
 * PASS:  low risk, proceed normally
 * FLAG:  medium risk, proceed but notify user
 * AWAIT: high risk, require explicit user approval
 * BLOCK: very high risk or dangerous pattern, stop completely
 */
function decide(score, action) {
  // Always block certain dangerous patterns regardless of score
  const combined = (action.action + ' ' + action.description).toLowerCase()
  if (/format.*(disk|drive|volume)|rm -rf|wipe.*(disk|drive)/.test(combined)) {
    return 'block'
  }

  if (score >= 9) return 'block'
  if (score >= 7) return 'await'
  if (score >= 5) return 'flag'
  return 'pass'
}

// ── Telegram notifications ─────────────────────────────────────

/**
 * Send a Telegram alert for a flagged action.
 * No buttons needed — just informing the user.
 */
async function sendFlagAlert(entry) {
  if (!bot) return

  const message = [
    `⚠️ *AgentGuard — Action Flagged*`,
    ``,
    `OpenClaw is about to:`,
    `_${entry.description}_`,
    ``,
    `Domain: ${entry.domain}`,
    `Risk score: ${entry.riskScore}/10`,
    entry.reversible === false ? `Cannot be undone ⚠️` : `Reversible ✅`,
    ``,
    `Action proceeding automatically.`
  ].join('\n')

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[AgentGuard] Failed to send Telegram flag alert:', err.message)
  }
}

/**
 * Send a Telegram message with Approve/Deny buttons for await decisions.
 * The user taps a button and the bot handles the callback.
 */
async function sendApprovalRequest(entry) {
  if (!bot) return

  const message = [
    `⏳ *AgentGuard — Approval Required*`,
    ``,
    `OpenClaw wants to:`,
    `_${entry.description}_`,
    ``,
    `Domain: ${entry.domain}`,
    `Risk score: ${entry.riskScore}/10`,
    entry.reversible === false ? `Cannot be undone ⚠️` : `Reversible ✅`,
    ``,
    `Factors: ${entry.factors.join(', ')}`
  ].join('\n')

  // Inline keyboard with Approve and Deny buttons
  // callback_data carries the action and ID so we know which approval to update
  const keyboard = {
    inline_keyboard: [[
      { text: '✅ Approve', callback_data: `approve:${entry.id}` },
      { text: '🚫 Deny', callback_data: `deny:${entry.id}` }
    ]]
  }

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, {
      parse_mode: 'Markdown',
      reply_markup: keyboard
    })
    console.log(`📱 Approval request sent to Telegram for: ${entry.action}`)
  } catch (err) {
    console.error('[AgentGuard] Failed to send Telegram approval request:', err.message)
  }
}

/**
 * Send a Telegram alert for a blocked action.
 * Informs the user that something was stopped automatically.
 */
async function sendBlockAlert(entry) {
  if (!bot) return

  const message = [
    `🚫 *AgentGuard — Action Blocked*`,
    ``,
    `OpenClaw tried to:`,
    `_${entry.description}_`,
    ``,
    `Domain: ${entry.domain}`,
    `Risk score: ${entry.riskScore}/10`,
    ``,
    `This action was automatically blocked.`,
    `If you want to allow it, tell OpenClaw directly.`
  ].join('\n')

  try {
    await bot.sendMessage(TELEGRAM_CHAT_ID, message, { parse_mode: 'Markdown' })
  } catch (err) {
    console.error('[AgentGuard] Failed to send Telegram block alert:', err.message)
  }
}

// ── Routes ─────────────────────────────────────────────────────

/**
 * POST /log
 * OpenClaw calls this before every sensitive action.
 * We score it, decide, notify via Telegram, and return the decision.
 */
app.post('/log', async (req, res) => {
  const action = req.body

  if (!action.action || !action.description) {
    return res.status(400).json({ error: 'Missing action or description' })
  }

  // Score and decide
  const { score, factors } = scoreRisk(action)
  const decision = decide(score, action)

  // Build the log entry
  const entry = {
    id: `ag_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    ...action,
    riskScore: score,
    factors,
    decision,
    timestamp: new Date().toISOString(),
    outcome: decision === 'block' ? 'blocked' : 'pending'
  }

  actionLog.push(entry)

  // Console log for the operator
  const emoji = { pass: '✅', flag: '⚠️', block: '🚫', await: '⏳' }[decision]
  console.log(`\n${emoji} [AgentGuard] ${decision.toUpperCase()} — ${action.action}`)
  console.log(`   Risk: ${score}/10 | ${factors.join(', ')}`)
  console.log(`   "${action.description}"`)

  // Send Telegram notifications based on decision
  if (decision === 'flag') {
    await sendFlagAlert(entry)
  }

  if (decision === 'await') {
    // Add to pending approvals and send Telegram approval request with buttons
    pendingApprovals.set(entry.id, {
      ...entry,
      status: 'pending',
      createdAt: new Date().toISOString()
    })
    await sendApprovalRequest(entry)
  }

  if (decision === 'block') {
    await sendBlockAlert(entry)
  }

  res.json({
    id: entry.id,
    decision,
    riskScore: score,
    factors,
    message: getMessage(decision, action)
  })
})

/**
 * GET /approval/:id
 * OpenClaw polls this while waiting for user approval.
 * Returns current status: pending | approved | denied
 */
app.get('/approval/:id', (req, res) => {
  const approval = pendingApprovals.get(req.params.id)

  if (!approval) {
    return res.status(404).json({ error: 'Approval not found' })
  }

  res.json({
    id: approval.id,
    status: approval.status,
    action: approval.action,
    description: approval.description
  })
})

/**
 * POST /approval/:id/approve
 * Fallback approve endpoint for when Telegram isn't set up.
 */
app.post('/approval/:id/approve', (req, res) => {
  const approval = pendingApprovals.get(req.params.id)
  if (!approval) return res.status(404).json({ error: 'Not found' })

  approval.status = 'approved'
  approval.resolvedAt = new Date().toISOString()

  const entry = actionLog.find(e => e.id === req.params.id)
  if (entry) entry.outcome = 'approved'

  console.log(`\n✅ [AgentGuard] APPROVED via API: ${approval.action}`)
  res.json({ status: 'approved' })
})

/**
 * POST /approval/:id/deny
 * Fallback deny endpoint for when Telegram isn't set up.
 */
app.post('/approval/:id/deny', (req, res) => {
  const approval = pendingApprovals.get(req.params.id)
  if (!approval) return res.status(404).json({ error: 'Not found' })

  approval.status = 'denied'
  approval.resolvedAt = new Date().toISOString()

  const entry = actionLog.find(e => e.id === req.params.id)
  if (entry) entry.outcome = 'denied'

  console.log(`\n🚫 [AgentGuard] DENIED via API: ${approval.action}`)
  res.json({ status: 'denied' })
})

/**
 * GET /log
 * Returns the full action log for this session.
 */
app.get('/log', (req, res) => {
  res.json({
    total: actionLog.length,
    blocked: actionLog.filter(e => e.outcome === 'blocked').length,
    flagged: actionLog.filter(e => e.decision === 'flag').length,
    approved: actionLog.filter(e => e.outcome === 'approved').length,
    actions: actionLog
  })
})

/**
 * GET /summary
 * Plain-English summary of recent activity.
 * OpenClaw calls this to answer "what have you been doing?"
 */
app.get('/summary', (req, res) => {
  const recent = actionLog.slice(-20)

  if (recent.length === 0) {
    return res.json({ summary: 'No actions logged yet this session.' })
  }

  const blocked = recent.filter(e => e.outcome === 'blocked')
  const flagged = recent.filter(e => e.decision === 'flag')
  const passed = recent.filter(e => e.decision === 'pass')

  const lines = [
    `In this session I logged ${recent.length} action(s):`,
    passed.length > 0 && `✅ ${passed.length} low-risk action(s) passed automatically`,
    flagged.length > 0 && `⚠️ ${flagged.length} action(s) were flagged as medium-risk`,
    blocked.length > 0 && `🚫 ${blocked.length} action(s) were blocked`,
    '',
    'Recent actions:',
    ...recent.slice(-5).map(e =>
      `• [${e.decision.toUpperCase()}] ${e.description} (risk: ${e.riskScore}/10)`
    )
  ].filter(Boolean)

  res.json({ summary: lines.join('\n') })
})

/**
 * GET /health
 * Simple health check.
 */
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'agentguard-openclaw',
    version: '0.1.0',
    telegram: bot ? 'connected' : 'not configured',
    actionsLogged: actionLog.length,
    pendingApprovals: pendingApprovals.size
  })
})

// ── Helper ─────────────────────────────────────────────────────

function getMessage(decision, action) {
  switch (decision) {
    case 'pass':
      return 'Action approved. Proceed normally.'
    case 'flag':
      return 'Action flagged. You may proceed but the user has been notified via Telegram.'
    case 'block':
      return `Action blocked. Do not proceed with: ${action.description}`
    case 'await':
      return 'Action requires user approval. Poll the approval endpoint until resolved.'
    default:
      return 'Unknown decision.'
  }
}

// ── Start ──────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════╗
║   AgentGuard for OpenClaw                ║
║   Listening on http://localhost:${PORT}    ║
║                                          ║
║   Your lobster is now accountable. 🛡️    ║
╚══════════════════════════════════════════╝
  `)
})
