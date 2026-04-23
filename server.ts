import express from "express";
import { createServer as createViteServer } from "vite";
import path from "path";
import dotenv from "dotenv";
import { promises as fs } from "fs";
import crypto from "crypto";

dotenv.config();

const PORT = 3000;
const DATA_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DATA_DIR, "db.json");

type UserRole = "superadmin" | "admin" | "defensor" | "analista";
type UserPlan = "trial" | "pro" | "enterprise";
type UserStatus = "active" | "pending" | "suspended";
type AiProvider = "gemini" | "groq" | "chatgpt";
type BackendLogLevel = "info" | "warn" | "error";

interface UserRecord {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  org: string;
  plan: UserPlan;
  status: UserStatus;
  lastActive: string;
  createdAt: string;
  expirationDate?: string;
  passwordHash: string;
  passwordSalt: string;
}

interface CaseRecord {
  id: number;
  userId: string;
  description: string;
  minutaPeca: string;
  diagnostico: string;
  estrategiaBusca: string;
  createdAt: string;
}

interface SearchRecord {
  id: number;
  userId: string;
  term: string;
  result: string;
  createdAt: string;
}

interface RulingRecord {
  id: number;
  userId: string;
  text: string;
  result: string;
  createdAt: string;
}

interface AnalystToolOutput {
  tool: string;
  content: string;
}

interface AnalystChatMessage {
  id: number;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  thinking?: string;
  toolOutputs?: AnalystToolOutput[];
}

interface AnalystChatRecord {
  id: number;
  userId: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: AnalystChatMessage[];
}

interface AiConfig {
  provider: AiProvider;
  apiKey: string;
  model: string;
  updatedAt: string;
}

interface JsonDB {
  users: UserRecord[];
  cases: CaseRecord[];
  searches: SearchRecord[];
  rulings: RulingRecord[];
  analystChats: AnalystChatRecord[];
  aiConfig: AiConfig;
  counters: {
    caseId: number;
    searchId: number;
    rulingId: number;
    chatId: number;
    chatMessageId: number;
  };
}

interface CheckboxCaptchaTask {
  id: string;
  label: string;
  expected: boolean;
}

interface BackendLogEntry {
  id: number;
  timestamp: string;
  level: BackendLogLevel;
  source: string;
  message: string;
  meta?: Record<string, unknown>;
}

const initialDB: JsonDB = {
  users: [],
  cases: [],
  searches: [],
  rulings: [],
  analystChats: [],
  aiConfig: {
    provider: "gemini",
    apiKey: "",
    model: "gemini-2.0-flash",
    updatedAt: nowIso(),
  },
  counters: {
    caseId: 1,
    searchId: 1,
    rulingId: 1,
    chatId: 1,
    chatMessageId: 1,
  },
};

let db: JsonDB = structuredClone(initialDB);
let writeQueue = Promise.resolve();
const captchaStore = new Map<string, { answer: string; expiresAt: number }>();
const resetChallengeStore = new Map<
  string,
  { tasks: CheckboxCaptchaTask[]; expiresAt: number }
>();
const backendLogs: BackendLogEntry[] = [];
const MAX_BACKEND_LOGS = 500;
let backendLogCounter = 1;

function pushBackendLog(
  level: BackendLogLevel,
  source: string,
  message: string,
  meta?: Record<string, unknown>
) {
  const entry: BackendLogEntry = {
    id: backendLogCounter++,
    timestamp: nowIso(),
    level,
    source,
    message,
    ...(meta ? { meta } : {}),
  };

  backendLogs.push(entry);
  if (backendLogs.length > MAX_BACKEND_LOGS) {
    backendLogs.splice(0, backendLogs.length - MAX_BACKEND_LOGS);
  }

  return entry;
}

function listBackendLogs(limit = 100, afterId?: number) {
  const normalizedLimit = Math.max(1, Math.min(500, limit));
  const filtered =
    typeof afterId === "number" && Number.isFinite(afterId)
      ? backendLogs.filter((entry) => entry.id > afterId)
      : backendLogs;

  return filtered.slice(-normalizedLimit);
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}

function parseNumericId(param: string) {
  const value = Number(param);
  if (!Number.isInteger(value) || value <= 0) {
    return null;
  }
  return value;
}

function sanitizeUser(user: UserRecord) {
  const { passwordHash: _passwordHash, passwordSalt: _passwordSalt, ...safeUser } =
    user;
  return safeUser;
}

function hasSuperAdmin() {
  return db.users.some((user) => user.role === "superadmin");
}

function hashPassword(password: string, salt: string) {
  return crypto
    .pbkdf2Sync(password, salt, 120000, 64, "sha512")
    .toString("hex");
}

function createPasswordCredentials(password: string) {
  const passwordSalt = crypto.randomBytes(16).toString("hex");
  const passwordHash = hashPassword(password, passwordSalt);
  return { passwordSalt, passwordHash };
}

function verifyPassword(password: string, passwordSalt: string, passwordHash: string) {
  const computed = hashPassword(password, passwordSalt);
  return crypto.timingSafeEqual(Buffer.from(computed), Buffer.from(passwordHash));
}

function createMathCaptcha() {
  let left = Math.floor(Math.random() * 8) + 2;
  let right = Math.floor(Math.random() * 8) + 2;
  const operations = ["+", "-"] as const;
  const op = operations[Math.floor(Math.random() * operations.length)];

  if (op === "-" && left < right) {
    const temp = left;
    left = right;
    right = temp;
  }

  const answer = op === "+" ? left + right : left - right;
  const question = `${left} ${op} ${right} = ?`;
  const captchaId = crypto.randomUUID();

  captchaStore.set(captchaId, {
    answer: String(answer),
    expiresAt: Date.now() + 5 * 60 * 1000,
  });

  return { captchaId, question };
}

function verifyMathCaptcha(captchaId?: string, captchaAnswer?: string) {
  if (!captchaId || !captchaAnswer) {
    return false;
  }

  const challenge = captchaStore.get(captchaId);
  if (!challenge) {
    return false;
  }

  if (Date.now() > challenge.expiresAt) {
    captchaStore.delete(captchaId);
    return false;
  }

  captchaStore.delete(captchaId);
  return challenge.answer === captchaAnswer.trim();
}

function createResetCheckboxChallenge() {
  const tasks: CheckboxCaptchaTask[] = [];

  for (let i = 0; i < 3; i++) {
    const a = Math.floor(Math.random() * 20) + 1;
    const b = Math.floor(Math.random() * 20) + 1;
    const real = a + b;
    const fake = real + (Math.random() > 0.5 ? 1 : -1);
    const showCorrect = Math.random() > 0.5;
    const shown = showCorrect ? real : fake;

    tasks.push({
      id: crypto.randomUUID(),
      label: `A afirmacao "${a} + ${b} = ${shown}" e verdadeira.`,
      expected: showCorrect,
    });
  }

  const challengeId = crypto.randomUUID();
  resetChallengeStore.set(challengeId, {
    tasks,
    expiresAt: Date.now() + 2 * 60 * 1000,
  });

  return {
    challengeId,
    tasks: tasks.map((task) => ({ id: task.id, label: task.label })),
  };
}

function verifyResetChallenge(challengeId?: string, answers?: Record<string, boolean>) {
  if (!challengeId || !answers || typeof answers !== "object") {
    return false;
  }

  const challenge = resetChallengeStore.get(challengeId);
  if (!challenge) {
    return false;
  }

  if (Date.now() > challenge.expiresAt) {
    resetChallengeStore.delete(challengeId);
    return false;
  }

  resetChallengeStore.delete(challengeId);
  return challenge.tasks.every((task) => answers[task.id] === task.expected);
}

function defaultModelForProvider(provider: AiProvider) {
  if (provider === "groq") return "llama-3.3-70b-versatile";
  if (provider === "chatgpt") return "gpt-4o-mini";
  return "gemini-2.0-flash";
}

function cleanupMockUsers() {
  const knownMockEmails = new Set([
    "admin@defensoria.ia",
    "lucas@defensoria.ia",
    "analista@defensoria.ia",
  ]);

  const mockIds = new Set(
    db.users
      .filter(
        (user) =>
          user.id.startsWith("mock_") ||
          knownMockEmails.has(normalizeEmail(user.email))
      )
      .map((user) => user.id)
  );

  if (mockIds.size === 0) {
    return false;
  }

  db.users = db.users.filter((user) => !mockIds.has(user.id));
  db.cases = db.cases.filter((item) => !mockIds.has(item.userId));
  db.searches = db.searches.filter((item) => !mockIds.has(item.userId));
  db.rulings = db.rulings.filter((item) => !mockIds.has(item.userId));
  db.analystChats = db.analystChats.filter((item) => !mockIds.has(item.userId));
  return true;
}

function ensureEnvSuperAdmin() {
  const superEmail = process.env.SUPERADMIN_EMAIL;
  const superPassword = process.env.SUPERADMIN_PASSWORD;

  if (!superEmail || !superPassword) {
    return false;
  }

  const normalized = normalizeEmail(superEmail);
  const existing = db.users.find((user) => normalizeEmail(user.email) === normalized);
  if (existing) {
    return false;
  }

  const timestamp = nowIso();
  const credentials = createPasswordCredentials(superPassword);

  db.users.push({
    id: `usr_${Date.now()}`,
    name: "Superadmin",
    email: normalized,
    role: "superadmin",
    org: "Sede Central",
    plan: "enterprise",
    status: "active",
    lastActive: timestamp,
    createdAt: timestamp,
    expirationDate: undefined,
    ...credentials,
  });

  return true;
}

async function ensureDbFile() {
  await fs.mkdir(DATA_DIR, { recursive: true });

  try {
    await fs.access(DB_PATH);
  } catch {
    await fs.writeFile(DB_PATH, `${JSON.stringify(initialDB, null, 2)}\n`, "utf-8");
  }
}

async function persistDb() {
  writeQueue = writeQueue.then(() =>
    fs.writeFile(DB_PATH, `${JSON.stringify(db, null, 2)}\n`, "utf-8")
  );

  await writeQueue;
}

async function loadDb() {
  await ensureDbFile();

  try {
    const file = await fs.readFile(DB_PATH, "utf-8");
    const parsed = JSON.parse(file) as Partial<JsonDB>;

    db = {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      cases: Array.isArray(parsed.cases) ? parsed.cases : [],
      searches: Array.isArray(parsed.searches) ? parsed.searches : [],
      rulings: Array.isArray(parsed.rulings) ? parsed.rulings : [],
      analystChats: Array.isArray(parsed.analystChats) ? parsed.analystChats : [],
      aiConfig: {
        provider:
          parsed.aiConfig?.provider === "groq" ||
          parsed.aiConfig?.provider === "chatgpt" ||
          parsed.aiConfig?.provider === "gemini"
            ? parsed.aiConfig.provider
            : "gemini",
        apiKey: typeof parsed.aiConfig?.apiKey === "string" ? parsed.aiConfig.apiKey : "",
        model:
          typeof parsed.aiConfig?.model === "string" && parsed.aiConfig.model.length > 0
            ? parsed.aiConfig.model
            : defaultModelForProvider(
                parsed.aiConfig?.provider === "groq" ||
                  parsed.aiConfig?.provider === "chatgpt" ||
                  parsed.aiConfig?.provider === "gemini"
                  ? parsed.aiConfig.provider
                  : "gemini"
              ),
        updatedAt:
          typeof parsed.aiConfig?.updatedAt === "string"
            ? parsed.aiConfig.updatedAt
            : nowIso(),
      },
      counters: {
        caseId: Number(parsed.counters?.caseId ?? 1),
        searchId: Number(parsed.counters?.searchId ?? 1),
        rulingId: Number(parsed.counters?.rulingId ?? 1),
        chatId: Number(parsed.counters?.chatId ?? 1),
        chatMessageId: Number(parsed.counters?.chatMessageId ?? 1),
      },
    };

    db.users = db.users.map((user) => {
      const typed = user as Partial<UserRecord>;
      const normalizedEmail = typed.email ? normalizeEmail(typed.email) : "";
      const fallbackPassword = createPasswordCredentials("ChangeMe123!");

      return {
        id: typed.id || `usr_${Date.now()}`,
        name: typed.name || "Usuario",
        email: normalizedEmail,
        role: (typed.role as UserRole) || "defensor",
        org: typed.org || "DP-Geral",
        plan: (typed.plan as UserPlan) || "trial",
        status: (typed.status as UserStatus) || "active",
        lastActive: typed.lastActive || nowIso(),
        createdAt: typed.createdAt || nowIso(),
        expirationDate: typed.expirationDate,
        passwordHash: typed.passwordHash || fallbackPassword.passwordHash,
        passwordSalt: typed.passwordSalt || fallbackPassword.passwordSalt,
      };
    });

    db.analystChats = db.analystChats
      .filter((chat) => Boolean(chat && typeof chat === "object"))
      .map((chat) => {
        const typed = chat as Partial<AnalystChatRecord>;
        return {
          id: typeof typed.id === "number" ? typed.id : db.counters.chatId++,
          userId: typeof typed.userId === "string" ? typed.userId : "",
          title: typeof typed.title === "string" && typed.title.trim().length > 0 ? typed.title.trim() : "Novo chat de analise",
          createdAt: typeof typed.createdAt === "string" ? typed.createdAt : nowIso(),
          updatedAt: typeof typed.updatedAt === "string" ? typed.updatedAt : nowIso(),
          messages: Array.isArray(typed.messages)
            ? typed.messages
                .filter((msg) => msg && typeof msg === "object")
                .map((msg) => {
                  const typedMsg = msg as Partial<AnalystChatMessage>;
                  const role: "assistant" | "user" =
                    typedMsg.role === "assistant" ? "assistant" : "user";
                  return {
                    id:
                      typeof typedMsg.id === "number"
                        ? typedMsg.id
                        : db.counters.chatMessageId++,
                    role,
                    content: typeof typedMsg.content === "string" ? typedMsg.content : "",
                    createdAt:
                      typeof typedMsg.createdAt === "string" ? typedMsg.createdAt : nowIso(),
                    thinking:
                      typeof typedMsg.thinking === "string" ? typedMsg.thinking : undefined,
                    toolOutputs: Array.isArray(typedMsg.toolOutputs)
                      ? typedMsg.toolOutputs
                          .filter((output) => output && typeof output === "object")
                          .map((output) => {
                            const typedOutput = output as Partial<AnalystToolOutput>;
                            return {
                              tool:
                                typeof typedOutput.tool === "string"
                                  ? typedOutput.tool
                                  : "tool",
                              content:
                                typeof typedOutput.content === "string"
                                  ? typedOutput.content
                                  : "",
                            };
                          })
                      : undefined,
                  };
                })
            : [],
        };
      })
      .filter((chat) => chat.userId.length > 0);

    const cleaned = cleanupMockUsers();
    const createdEnvSuperAdmin = ensureEnvSuperAdmin();
    if (cleaned || createdEnvSuperAdmin) {
      await persistDb();
    }
  } catch (error) {
    console.error("Failed to read data/db.json. Starting with empty DB:", error);
    db = structuredClone(initialDB);
    ensureEnvSuperAdmin();
    await persistDb();
  }
}

function getRequestUser(req: express.Request) {
  const uid = req.headers["x-user-id"] as string | undefined;
  if (!uid) {
    return null;
  }

  return db.users.find((u) => u.id === uid) || null;
}

function requireSuperAdmin(req: express.Request, res: express.Response) {
  const actor = getRequestUser(req);

  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (actor.role !== "superadmin") {
    res.status(403).json({ error: "Only superadmin can access this route" });
    return null;
  }

  if (actor.status !== "active") {
    res.status(403).json({ error: "Superadmin is not active" });
    return null;
  }

  return actor;
}

function requireActiveUser(req: express.Request, res: express.Response) {
  const actor = getRequestUser(req);
  if (!actor) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }

  if (actor.status !== "active") {
    res.status(403).json({ error: "Usuario sem acesso ativo" });
    return null;
  }

  return actor;
}

class HttpError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function parseProviderErrorMessage(rawBody: string) {
  try {
    const parsed = JSON.parse(rawBody) as { error?: { message?: string } | string };
    if (typeof parsed.error === "string") {
      return parsed.error;
    }
    if (parsed.error && typeof parsed.error.message === "string") {
      return parsed.error.message;
    }
  } catch {
    // Ignore parse failures and use compact raw text below.
  }

  const compact = rawBody.replace(/\s+/g, " ").trim();
  return compact.length > 180 ? `${compact.slice(0, 180)}...` : compact;
}

function summarizeAiOutput(text: string) {
  const compact = (text || "").replace(/\s+/g, " ").trim();
  if (!compact) {
    return "(sem conteudo)";
  }
  return compact.length > 220 ? `${compact.slice(0, 220)}...` : compact;
}

function unknownErrorMessage(error: unknown) {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Erro desconhecido";
}

function fallbackChatTitleFromText(text: string) {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (!clean) {
    return "Novo chat de analise";
  }

  const noPunctuation = clean.replace(/[.,;:!?()\[\]{}"']/g, " ").trim();
  const words = noPunctuation.split(/\s+/).filter(Boolean).slice(0, 7);
  const title = words.join(" ").trim();
  return title.length > 0 ? title : "Novo chat de analise";
}

async function maybeGenerateChatTitle(seedText: string) {
  try {
    const prompt = `Crie um titulo curto (maximo 7 palavras) para este chat juridico. Retorne apenas o titulo, sem aspas:\n\n${seedText}`;
    const title = (await callAiProvider(prompt)).replace(/\s+/g, " ").trim();
    if (title.length > 0) {
      return title.slice(0, 80);
    }
  } catch {
    // fallback handled below
  }

  return fallbackChatTitleFromText(seedText);
}

interface AnalystPlan {
  thinkingSummary: string;
  reply: string;
  requestedTools: string[];
}

async function buildAnalystPlan(message: string, history: AnalystChatMessage[]) {
  const historyText = history
    .slice(-8)
    .map((entry) => `${entry.role === "assistant" ? "Assistente" : "Usuario"}: ${entry.content}`)
    .join("\n");

  const prompt = `Voce e um analista juridico em chat.\nRetorne JSON com os campos:\n- thinkingSummary (resumo curto de raciocinio, sem expor cadeia completa)\n- reply (resposta principal em markdown)\n- requestedTools (array com zero ou mais valores entre: create_complete_document, find_precedents, build_search_string)\n\nHistorico:\n${historyText || "(sem historico)"}\n\nMensagem do usuario:\n${message}`;

  const raw = await callAiProvider(prompt, true);
  const parsed = parseJsonObjectFromModelText(raw);

  if (!parsed) {
    return {
      thinkingSummary: "Sem plano estruturado retornado pela IA.",
      reply: raw || "Nao foi possivel gerar resposta estruturada.",
      requestedTools: [],
    } as AnalystPlan;
  }

  const requested = Array.isArray(parsed.requestedTools)
    ? parsed.requestedTools
        .map((value) => String(value))
        .filter((value) =>
          value === "create_complete_document" ||
          value === "find_precedents" ||
          value === "build_search_string"
        )
    : [];

  return {
    thinkingSummary:
      typeof parsed.thinkingSummary === "string"
        ? parsed.thinkingSummary
        : "Resumo de pensamento indisponivel.",
    reply:
      typeof parsed.reply === "string"
        ? parsed.reply
        : "Nao foi possivel gerar resposta principal.",
    requestedTools: requested,
  };
}

async function executeAnalystTools(
  tools: string[],
  userMessage: string,
  history: AnalystChatMessage[]
) {
  const outputs: AnalystToolOutput[] = [];
  const limitedTools = tools.slice(0, 3);
  const context = history
    .slice(-6)
    .map((entry) => `${entry.role}: ${entry.content}`)
    .join("\n");

  for (const tool of limitedTools) {
    if (tool === "create_complete_document") {
      const result = await callAiProvider(
        `Crie um documento juridico completo em markdown com secoes (fatos, fundamentos, pedidos, estrategia de prova), usando este contexto:\n${context}\n\nMensagem atual: ${userMessage}`
      );
      outputs.push({ tool, content: result || "Sem conteudo retornado." });
      continue;
    }

    if (tool === "find_precedents") {
      const result = await callAiProvider(
        `Com base na mensagem, liste 3 precedentes possiveis (STJ/STF), em markdown, com numero, tribunal e tese: ${userMessage}`
      );
      outputs.push({ tool, content: result || "Sem precedentes retornados." });
      continue;
    }

    if (tool === "build_search_string") {
      const result = await callAiProvider(
        `Gere string booleana de busca juridica com base na mensagem: ${userMessage}. Retorne apenas a string.`
      );
      outputs.push({ tool, content: result || "Sem string retornada." });
    }
  }

  return outputs;
}

async function buildAnalystAssistantMessage(
  userMessage: string,
  history: AnalystChatMessage[]
) {
  const plan = await buildAnalystPlan(userMessage, history);
  const toolOutputs = await executeAnalystTools(plan.requestedTools, userMessage, history);

  return {
    content: plan.reply,
    thinking: plan.thinkingSummary,
    toolOutputs,
  };
}

function parseJsonObjectFromModelText(text: string) {
  const clean = (text || "").trim();
  if (!clean) {
    return null;
  }

  const candidates = [clean];
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (fenced?.[1]) {
    candidates.push(fenced[1].trim());
  }

  const firstBrace = clean.indexOf("{");
  const lastBrace = clean.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(clean.slice(firstBrace, lastBrace + 1));
  }

  for (const value of candidates) {
    try {
      const parsed = JSON.parse(value) as Record<string, unknown>;
      if (parsed && typeof parsed === "object") {
        return parsed;
      }
    } catch {
      // Continue trying the next candidate.
    }
  }

  return null;
}

function sendAiError(
  res: express.Response,
  context: string,
  error: unknown,
  fallbackMessage: string,
  meta?: Record<string, unknown>
) {
  console.error(`${context}:`, error);

  const aiMessage = unknownErrorMessage(error);
  pushBackendLog("error", "ai", context, {
    aiMessage,
    ...(meta || {}),
  });

  if (error instanceof HttpError) {
    return res.status(error.status).json({ error: error.message, aiMessage });
  }

  return res.status(500).json({ error: fallbackMessage, aiMessage });
}

async function callAiProvider(prompt: string, responseAsJson = false) {
  const provider = db.aiConfig.provider;
  const model = db.aiConfig.model || defaultModelForProvider(provider);
  const apiKey = db.aiConfig.apiKey;

  if (!apiKey) {
    throw new HttpError(
      400,
      "Chave global de IA nao configurada. Defina em Configuracoes do superadmin."
    );
  }

  if (provider === "gemini") {
    const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
      model
    )}:generateContent?key=${encodeURIComponent(apiKey)}`;

    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: responseAsJson
          ? { responseMimeType: "application/json" }
          : undefined,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      const providerMessage = parseProviderErrorMessage(body);
      throw new HttpError(
        502,
        `Falha no provedor Gemini (${response.status}). ${providerMessage}`
      );
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    const modelText = payload.candidates?.[0]?.content?.parts?.[0]?.text || "";
    return modelText;
  }

  const isGroq = provider === "groq";
  const endpoint = isGroq
    ? "https://api.groq.com/openai/v1/chat/completions"
    : "https://api.openai.com/v1/chat/completions";

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.2,
      messages: [{ role: "user", content: prompt }],
      ...(responseAsJson ? { response_format: { type: "json_object" } } : {}),
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const providerName = provider === "chatgpt" ? "ChatGPT" : "Groq";
    const providerMessage = parseProviderErrorMessage(body);
    throw new HttpError(
      502,
      `Falha no provedor ${providerName} (${response.status}). ${providerMessage}`
    );
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  const modelText = payload.choices?.[0]?.message?.content || "";
  return modelText;
}

async function resetDatabaseToFactory() {
  db = structuredClone(initialDB);
  captchaStore.clear();
  resetChallengeStore.clear();
  await persistDb();
}

async function startServer() {
  await loadDb();

  const app = express();
  app.use(express.json());

  app.use((req, res, next) => {
    if (!req.path.startsWith("/api")) {
      next();
      return;
    }

    const start = Date.now();
    res.on("finish", () => {
      if (req.path === "/api/superadmin/logs") {
        return;
      }

      if (res.statusCode >= 500) {
        pushBackendLog("error", "http", `HTTP ${res.statusCode} ${req.method} ${req.path}`, {
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          durationMs: Date.now() - start,
        });
      }
    });

    next();
  });

  app.get("/api/auth/status", async (_req, res) => {
    return res.json({ hasSuperAdmin: hasSuperAdmin() });
  });

  app.get("/api/auth/captcha", async (_req, res) => {
    return res.json(createMathCaptcha());
  });

  app.post("/api/auth/setup-superadmin", async (req, res) => {
    const { name, email, password, captchaId, captchaAnswer } = req.body as {
      name?: string;
      email?: string;
      password?: string;
      captchaId?: string;
      captchaAnswer?: string;
    };

    if (hasSuperAdmin()) {
      return res.status(409).json({ error: "Superadmin ja configurado" });
    }

    if (!name || !email || !password || !captchaId || !captchaAnswer) {
      return res
        .status(400)
        .json({ error: "name, email, password, captchaId and captchaAnswer are required" });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: "Senha deve ter no minimo 8 caracteres" });
    }

    if (!verifyMathCaptcha(captchaId, captchaAnswer)) {
      return res.status(400).json({ error: "Captcha invalido ou expirado" });
    }

    const normalizedEmail = normalizeEmail(email);
    const duplicate = db.users.find((user) => normalizeEmail(user.email) === normalizedEmail);
    if (duplicate) {
      return res.status(409).json({ error: "Email ja esta em uso" });
    }

    const timestamp = nowIso();
    const credentials = createPasswordCredentials(password);

    const created: UserRecord = {
      id: `usr_${Date.now()}`,
      name,
      email: normalizedEmail,
      role: "superadmin",
      org: "Sede Central",
      plan: "enterprise",
      status: "active",
      lastActive: timestamp,
      createdAt: timestamp,
      expirationDate: undefined,
      ...credentials,
    };

    db.users.push(created);
    await persistDb();
    return res.status(201).json(sanitizeUser(created));
  });

  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return res.status(400).json({ error: "email and password are required" });
    }

    const normalizedEmail = normalizeEmail(email);
    const user = db.users.find((u) => normalizeEmail(u.email) === normalizedEmail);

    if (!user) {
      return res.status(401).json({ error: "Credenciais invalidas" });
    }

    if (!verifyPassword(password, user.passwordSalt, user.passwordHash)) {
      return res.status(401).json({ error: "Credenciais invalidas" });
    }

    if (user.status !== "active") {
      return res.status(403).json({ error: "Usuario sem acesso ativo" });
    }

    user.lastActive = nowIso();
    await persistDb();
    return res.json(sanitizeUser(user));
  });

  app.get("/api/health", async (_req, res) => {
    return res.json({
      ok: true,
      storage: "json",
      dbPath: DB_PATH,
      hasSuperAdmin: hasSuperAdmin(),
      stats: {
        users: db.users.length,
        cases: db.cases.length,
        searches: db.searches.length,
        rulings: db.rulings.length,
      },
    });
  });

  app.get("/api/users/me", async (req, res) => {
    const current = getRequestUser(req);
    if (!current) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    return res.json(sanitizeUser(current));
  });

  app.get("/api/superadmin/users", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const role = req.query.role as UserRole | undefined;
    const status = req.query.status as UserStatus | undefined;
    const org = req.query.org as string | undefined;

    const filtered = db.users.filter((user) => {
      const roleOk = role ? user.role === role : true;
      const statusOk = status ? user.status === status : true;
      const orgOk = org ? user.org.toLowerCase().includes(org.toLowerCase()) : true;
      return roleOk && statusOk && orgOk;
    });

    const ordered = [...filtered].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    return res.json(ordered.map(sanitizeUser));
  });

  app.post("/api/superadmin/users", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const payload = req.body as Partial<UserRecord> & { password?: string };
    if (!payload.name || !payload.email || !payload.password) {
      return res.status(400).json({ error: "name, email and password are required" });
    }

    if (payload.password.length < 8) {
      return res.status(400).json({ error: "Senha deve ter no minimo 8 caracteres" });
    }

    const normalizedEmail = normalizeEmail(payload.email);
    const duplicate = db.users.find((u) => normalizeEmail(u.email) === normalizedEmail);
    if (duplicate) {
      return res.status(409).json({ error: "Email ja esta em uso" });
    }

    const timestamp = nowIso();
    const credentials = createPasswordCredentials(payload.password);

    const created: UserRecord = {
      id: payload.id || `usr_${Date.now()}`,
      name: payload.name,
      email: normalizedEmail,
      role: (payload.role as UserRole) || "defensor",
      org: payload.org || "DP-Geral",
      plan: (payload.plan as UserPlan) || "trial",
      status: (payload.status as UserStatus) || "active",
      expirationDate: payload.expirationDate,
      createdAt: timestamp,
      lastActive: timestamp,
      ...credentials,
    };

    db.users.push(created);
    await persistDb();
    return res.status(201).json(sanitizeUser(created));
  });

  app.patch("/api/superadmin/users/:id", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const { id } = req.params;
    const index = db.users.findIndex((u) => u.id === id);
    if (index < 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const payload = req.body as Partial<UserRecord> & { password?: string };
    const current = db.users[index];

    const normalizedEmail = payload.email
      ? normalizeEmail(payload.email)
      : current.email;

    const duplicate = db.users.find(
      (u) => normalizeEmail(u.email) === normalizedEmail && u.id !== current.id
    );

    if (duplicate) {
      return res.status(409).json({ error: "Email ja esta em uso" });
    }

    const credentials = payload.password
      ? createPasswordCredentials(payload.password)
      : null;

    db.users[index] = {
      ...current,
      ...payload,
      id: current.id,
      email: normalizedEmail,
      createdAt: current.createdAt,
      lastActive: nowIso(),
      passwordHash: credentials ? credentials.passwordHash : current.passwordHash,
      passwordSalt: credentials ? credentials.passwordSalt : current.passwordSalt,
    };

    await persistDb();
    return res.json(sanitizeUser(db.users[index]));
  });

  app.delete("/api/superadmin/users/:id", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const { id } = req.params;

    if (id === actor.id) {
      return res.status(400).json({ error: "Superadmin logado nao pode deletar a propria conta" });
    }

    const target = db.users.find((u) => u.id === id);
    if (!target) {
      return res.status(404).json({ error: "User not found" });
    }

    db.users = db.users.filter((u) => u.id !== id);
    db.cases = db.cases.filter((item) => item.userId !== id);
    db.searches = db.searches.filter((item) => item.userId !== id);
    db.rulings = db.rulings.filter((item) => item.userId !== id);
    db.analystChats = db.analystChats.filter((item) => item.userId !== id);

    await persistDb();
    return res.status(204).send();
  });

  app.get("/api/superadmin/ai-config", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    return res.json({
      provider: db.aiConfig.provider,
      model: db.aiConfig.model,
      hasKey: db.aiConfig.apiKey.length > 0,
      updatedAt: db.aiConfig.updatedAt,
    });
  });

  app.patch("/api/superadmin/ai-config", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const { provider, model, apiKey } = req.body as {
      provider?: AiProvider;
      model?: string;
      apiKey?: string;
    };

    if (provider && provider !== "gemini" && provider !== "groq" && provider !== "chatgpt") {
      return res.status(400).json({ error: "Invalid provider" });
    }

    const nextProvider = provider || db.aiConfig.provider;

    db.aiConfig = {
      provider: nextProvider,
      model:
        typeof model === "string" && model.trim().length > 0
          ? model.trim()
          : db.aiConfig.model || defaultModelForProvider(nextProvider),
      apiKey:
        typeof apiKey === "string"
          ? apiKey.trim()
          : db.aiConfig.apiKey,
      updatedAt: nowIso(),
    };

    if (!db.aiConfig.model) {
      db.aiConfig.model = defaultModelForProvider(nextProvider);
    }

    await persistDb();

    return res.json({
      provider: db.aiConfig.provider,
      model: db.aiConfig.model,
      hasKey: db.aiConfig.apiKey.length > 0,
      updatedAt: db.aiConfig.updatedAt,
    });
  });

  app.get("/api/superadmin/logs", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const limitRaw = Number(req.query.limit ?? 100);
    const afterIdRaw = Number(req.query.afterId);

    const logs = listBackendLogs(
      Number.isFinite(limitRaw) ? limitRaw : 100,
      Number.isFinite(afterIdRaw) ? afterIdRaw : undefined
    );

    return res.json({
      logs,
      nextAfterId: logs.length ? logs[logs.length - 1].id : null,
      totalBuffered: backendLogs.length,
    });
  });

  app.post("/api/ai/analyze-case", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const { description } = req.body as { description?: string };
    if (!description) {
      return res.status(400).json({ error: "description is required" });
    }

    const prompt = `
Você e um Assessor Juridico da Defensoria Publica.
Analise o seguinte caso e retorne JSON com os campos:
- diagnostico
- estrategiaBusca
- sugestaoAutomacao
- minutaPeca

Caso: ${description}
`;

    try {
      pushBackendLog("info", "ai", "Solicitacao de analise de caso iniciada", {
        route: "/api/ai/analyze-case",
        userId: actor.id,
        provider: db.aiConfig.provider,
        model: db.aiConfig.model || defaultModelForProvider(db.aiConfig.provider),
      });

      const text = await callAiProvider(prompt, true);
      const parsed = parseJsonObjectFromModelText(text);

      if (!parsed) {
        const fallbackText = (text || "").trim();
        pushBackendLog("warn", "ai", "Resposta de IA sem JSON estruturado em analise de caso", {
          route: "/api/ai/analyze-case",
          userId: actor.id,
          aiMessage: summarizeAiOutput(text),
        });

        return res.json({
          diagnostico: fallbackText || "Analise gerada pela IA sem JSON estruturado.",
          estrategiaBusca: "",
          sugestaoAutomacao: "",
          minutaPeca: fallbackText || "",
        });
      }

      pushBackendLog("info", "ai", "Analise de caso concluida", {
        route: "/api/ai/analyze-case",
        userId: actor.id,
        aiMessage: summarizeAiOutput(text),
      });

      return res.json({
        diagnostico:
          typeof parsed.diagnostico === "string" ? parsed.diagnostico : "",
        estrategiaBusca:
          typeof parsed.estrategiaBusca === "string" ? parsed.estrategiaBusca : "",
        sugestaoAutomacao:
          typeof parsed.sugestaoAutomacao === "string" ? parsed.sugestaoAutomacao : "",
        minutaPeca:
          typeof parsed.minutaPeca === "string" ? parsed.minutaPeca : "",
      });
    } catch (error) {
      return sendAiError(
        res,
        "AI analyze-case failed",
        error,
        "Falha ao processar IA para caso",
        {
          route: "/api/ai/analyze-case",
          userId: actor.id,
        }
      );
    }
  });

  app.post("/api/ai/generate-search", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const { theme } = req.body as { theme?: string };
    if (!theme) {
      return res.status(400).json({ error: "theme is required" });
    }

    const prompt = `Gere uma string de busca booleana para STJ/TJ sobre: ${theme}. Retorne apenas a string.`;

    try {
      pushBackendLog("info", "ai", "Solicitacao de geracao de busca iniciada", {
        route: "/api/ai/generate-search",
        userId: actor.id,
        provider: db.aiConfig.provider,
        model: db.aiConfig.model || defaultModelForProvider(db.aiConfig.provider),
      });

      const text = await callAiProvider(prompt);
      pushBackendLog("info", "ai", "Geracao de busca concluida", {
        route: "/api/ai/generate-search",
        userId: actor.id,
        aiMessage: summarizeAiOutput(text),
      });
      return res.json({ result: text || "" });
    } catch (error) {
      return sendAiError(
        res,
        "AI generate-search failed",
        error,
        "Falha ao gerar string de busca",
        {
          route: "/api/ai/generate-search",
          userId: actor.id,
        }
      );
    }
  });

  app.post("/api/ai/analyze-ruling", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const { rulingText } = req.body as { rulingText?: string };
    if (!rulingText) {
      return res.status(400).json({ error: "rulingText is required" });
    }

    const prompt = `Analise este acordao e responda em markdown:\n1. Resumo dos argumentos vencedores.\n2. Se contraria decisoes recentes do STF.\n3. Se cabe overruling ou distinguishing.\n\nTexto: ${rulingText}`;

    try {
      pushBackendLog("info", "ai", "Solicitacao de analise de acordao iniciada", {
        route: "/api/ai/analyze-ruling",
        userId: actor.id,
        provider: db.aiConfig.provider,
        model: db.aiConfig.model || defaultModelForProvider(db.aiConfig.provider),
      });

      const text = await callAiProvider(prompt);
      pushBackendLog("info", "ai", "Analise de acordao concluida", {
        route: "/api/ai/analyze-ruling",
        userId: actor.id,
        aiMessage: summarizeAiOutput(text),
      });
      return res.json({ result: text || "" });
    } catch (error) {
      return sendAiError(
        res,
        "AI analyze-ruling failed",
        error,
        "Falha ao analisar acordao",
        {
          route: "/api/ai/analyze-ruling",
          userId: actor.id,
        }
      );
    }
  });

  app.post("/api/ai/find-similar-cases", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const { description } = req.body as { description?: string };
    if (!description) {
      return res.status(400).json({ error: "description is required" });
    }

    const prompt = `Com base nesta descricao, retorne em markdown 3 precedentes possiveis similares (STF/STJ), com numero processual, tribunal, relator e tese: ${description}`;

    try {
      pushBackendLog("info", "ai", "Solicitacao de busca de precedentes iniciada", {
        route: "/api/ai/find-similar-cases",
        userId: actor.id,
        provider: db.aiConfig.provider,
        model: db.aiConfig.model || defaultModelForProvider(db.aiConfig.provider),
      });

      const text = await callAiProvider(prompt);
      pushBackendLog("info", "ai", "Busca de precedentes concluida", {
        route: "/api/ai/find-similar-cases",
        userId: actor.id,
        aiMessage: summarizeAiOutput(text),
      });
      return res.json({ result: text || "" });
    } catch (error) {
      return sendAiError(
        res,
        "AI similar-cases failed",
        error,
        "Falha ao buscar precedentes",
        {
          route: "/api/ai/find-similar-cases",
          userId: actor.id,
        }
      );
    }
  });

  app.get("/api/analyst-chats", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const chats = db.analystChats
      .filter((chat) => chat.userId === actor.id)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      .map((chat) => {
        const last = chat.messages[chat.messages.length - 1];
        return {
          id: chat.id,
          title: chat.title,
          createdAt: chat.createdAt,
          updatedAt: chat.updatedAt,
          lastMessagePreview: last?.content?.slice(0, 160) || "",
          messagesCount: chat.messages.length,
        };
      });

    return res.json(chats);
  });

  app.get("/api/analyst-chats/:id", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const id = parseNumericId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid chat id" });
    }

    const chat = db.analystChats.find((entry) => entry.id === id && entry.userId === actor.id);
    if (!chat) {
      return res.status(404).json({ error: "Chat nao encontrado" });
    }

    return res.json(chat);
  });

  app.post("/api/analyst-chats", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const { message } = req.body as { message?: string };
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const userMessageText = message.trim();
    const timestamp = nowIso();
    const chat: AnalystChatRecord = {
      id: db.counters.chatId++,
      userId: actor.id,
      title: fallbackChatTitleFromText(userMessageText),
      createdAt: timestamp,
      updatedAt: timestamp,
      messages: [
        {
          id: db.counters.chatMessageId++,
          role: "user",
          content: userMessageText,
          createdAt: timestamp,
        },
      ],
    };

    db.analystChats.push(chat);

    try {
      const generatedTitle = await maybeGenerateChatTitle(userMessageText);
      chat.title = generatedTitle || chat.title;

      const assistant = await buildAnalystAssistantMessage(userMessageText, chat.messages);
      chat.messages.push({
        id: db.counters.chatMessageId++,
        role: "assistant",
        content: assistant.content,
        thinking: assistant.thinking,
        toolOutputs: assistant.toolOutputs,
        createdAt: nowIso(),
      });
      chat.updatedAt = nowIso();

      pushBackendLog("info", "ai", "Chat de analista criado com resposta da IA", {
        route: "/api/analyst-chats",
        userId: actor.id,
        chatId: chat.id,
      });
    } catch (error) {
      pushBackendLog("error", "ai", "Falha ao gerar resposta inicial do chat de analista", {
        route: "/api/analyst-chats",
        userId: actor.id,
        chatId: chat.id,
        aiMessage: unknownErrorMessage(error),
      });

      chat.messages.push({
        id: db.counters.chatMessageId++,
        role: "assistant",
        content:
          "Nao foi possivel gerar resposta da IA neste momento. Verifique a configuracao global e tente novamente.",
        thinking: "Falha ao executar fluxo de resposta.",
        toolOutputs: [
          {
            tool: "error",
            content: unknownErrorMessage(error),
          },
        ],
        createdAt: nowIso(),
      });
      chat.updatedAt = nowIso();
    }

    await persistDb();
    return res.status(201).json(chat);
  });

  app.post("/api/analyst-chats/:id/messages", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const id = parseNumericId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid chat id" });
    }

    const { message } = req.body as { message?: string };
    if (!message || !message.trim()) {
      return res.status(400).json({ error: "message is required" });
    }

    const chat = db.analystChats.find((entry) => entry.id === id && entry.userId === actor.id);
    if (!chat) {
      return res.status(404).json({ error: "Chat nao encontrado" });
    }

    const userMessageText = message.trim();
    chat.messages.push({
      id: db.counters.chatMessageId++,
      role: "user",
      content: userMessageText,
      createdAt: nowIso(),
    });

    try {
      const assistant = await buildAnalystAssistantMessage(userMessageText, chat.messages);
      chat.messages.push({
        id: db.counters.chatMessageId++,
        role: "assistant",
        content: assistant.content,
        thinking: assistant.thinking,
        toolOutputs: assistant.toolOutputs,
        createdAt: nowIso(),
      });

      pushBackendLog("info", "ai", "Mensagem adicional processada no chat de analista", {
        route: "/api/analyst-chats/:id/messages",
        userId: actor.id,
        chatId: chat.id,
      });
    } catch (error) {
      pushBackendLog("error", "ai", "Falha ao processar mensagem adicional no chat de analista", {
        route: "/api/analyst-chats/:id/messages",
        userId: actor.id,
        chatId: chat.id,
        aiMessage: unknownErrorMessage(error),
      });

      chat.messages.push({
        id: db.counters.chatMessageId++,
        role: "assistant",
        content:
          "Nao consegui processar sua mensagem agora. Ajuste o contexto ou tente novamente em instantes.",
        thinking: "Falha no fluxo de resposta incremental.",
        toolOutputs: [
          {
            tool: "error",
            content: unknownErrorMessage(error),
          },
        ],
        createdAt: nowIso(),
      });
    }

    chat.updatedAt = nowIso();
    await persistDb();
    return res.json(chat);
  });

  app.delete("/api/analyst-chats/:id", async (req, res) => {
    const actor = requireActiveUser(req, res);
    if (!actor) {
      return;
    }

    const id = parseNumericId(req.params.id);
    if (!id) {
      return res.status(400).json({ error: "Invalid chat id" });
    }

    const index = db.analystChats.findIndex(
      (entry) => entry.id === id && entry.userId === actor.id
    );

    if (index < 0) {
      return res.status(404).json({ error: "Chat nao encontrado" });
    }

    db.analystChats.splice(index, 1);
    await persistDb();
    return res.status(204).send();
  });

  app.get("/api/superadmin/reset-challenge", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    return res.json(createResetCheckboxChallenge());
  });

  app.post("/api/superadmin/reset-app", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const { challengeId, answers } = req.body as {
      challengeId?: string;
      answers?: Record<string, boolean>;
    };

    if (!verifyResetChallenge(challengeId, answers)) {
      return res.status(400).json({ error: "Mini-game captcha invalido ou expirado" });
    }

    await resetDatabaseToFactory();
    return res.json({ ok: true, message: "Sistema redefinido para padrao de fabrica" });
  });

  app.get("/api/admin/users", async (req, res) => {
    const actor = requireSuperAdmin(req, res);
    if (!actor) {
      return;
    }

    const ordered = [...db.users].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );
    return res.json(ordered.map(sanitizeUser));
  });

  app.post("/api/cases", async (req, res) => {
    const { userId, description, minutaPeca, diagnostico, estrategiaBusca } = req.body as {
      userId?: string;
      description?: string;
      minutaPeca?: string;
      diagnostico?: string;
      estrategiaBusca?: string;
    };

    if (!userId || !description || !minutaPeca || !diagnostico || !estrategiaBusca) {
      return res.status(400).json({ error: "Missing required case fields" });
    }

    const record: CaseRecord = {
      id: db.counters.caseId++,
      userId,
      description,
      minutaPeca,
      diagnostico,
      estrategiaBusca,
      createdAt: nowIso(),
    };

    db.cases.push(record);
    await persistDb();
    return res.json(record);
  });

  app.get("/api/cases", async (req, res) => {
    const userId = req.query.userId as string | undefined;
    const records = userId
      ? db.cases.filter((record) => record.userId === userId)
      : db.cases;

    const ordered = [...records].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    return res.json(ordered);
  });

  app.get("/api/cases/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid case id" });
    }

    const record = db.cases.find((item) => item.id === numericId);
    if (!record) {
      return res.status(404).json({ error: "Case not found" });
    }

    return res.json(record);
  });

  app.patch("/api/cases/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid case id" });
    }

    const index = db.cases.findIndex((item) => item.id === numericId);
    if (index < 0) {
      return res.status(404).json({ error: "Case not found" });
    }

    const payload = req.body as Partial<CaseRecord>;
    const current = db.cases[index];

    db.cases[index] = {
      ...current,
      ...payload,
      id: current.id,
      createdAt: current.createdAt,
      userId: current.userId,
    };

    await persistDb();
    return res.json(db.cases[index]);
  });

  app.delete("/api/cases/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid case id" });
    }

    const before = db.cases.length;
    db.cases = db.cases.filter((item) => item.id !== numericId);

    if (db.cases.length === before) {
      return res.status(404).json({ error: "Case not found" });
    }

    await persistDb();
    return res.status(204).send();
  });

  app.post("/api/searches", async (req, res) => {
    const { userId, term, result } = req.body as {
      userId?: string;
      term?: string;
      result?: string;
    };

    if (!userId || !term || !result) {
      return res.status(400).json({ error: "Missing required search fields" });
    }

    const record: SearchRecord = {
      id: db.counters.searchId++,
      userId,
      term,
      result,
      createdAt: nowIso(),
    };

    db.searches.push(record);
    await persistDb();
    return res.json(record);
  });

  app.get("/api/searches", async (req, res) => {
    const userId = req.query.userId as string | undefined;
    const records = userId
      ? db.searches.filter((record) => record.userId === userId)
      : db.searches;

    const ordered = [...records].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    return res.json(ordered);
  });

  app.get("/api/searches/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid search id" });
    }

    const record = db.searches.find((item) => item.id === numericId);
    if (!record) {
      return res.status(404).json({ error: "Search not found" });
    }

    return res.json(record);
  });

  app.patch("/api/searches/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid search id" });
    }

    const index = db.searches.findIndex((item) => item.id === numericId);
    if (index < 0) {
      return res.status(404).json({ error: "Search not found" });
    }

    const payload = req.body as Partial<SearchRecord>;
    const current = db.searches[index];

    db.searches[index] = {
      ...current,
      ...payload,
      id: current.id,
      createdAt: current.createdAt,
      userId: current.userId,
    };

    await persistDb();
    return res.json(db.searches[index]);
  });

  app.delete("/api/searches/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid search id" });
    }

    const before = db.searches.length;
    db.searches = db.searches.filter((item) => item.id !== numericId);

    if (db.searches.length === before) {
      return res.status(404).json({ error: "Search not found" });
    }

    await persistDb();
    return res.status(204).send();
  });

  app.post("/api/rulings", async (req, res) => {
    const { userId, text, result } = req.body as {
      userId?: string;
      text?: string;
      result?: string;
    };

    if (!userId || !text || !result) {
      return res.status(400).json({ error: "Missing required ruling fields" });
    }

    const record: RulingRecord = {
      id: db.counters.rulingId++,
      userId,
      text,
      result,
      createdAt: nowIso(),
    };

    db.rulings.push(record);
    await persistDb();
    return res.json(record);
  });

  app.get("/api/rulings", async (req, res) => {
    const userId = req.query.userId as string | undefined;
    const records = userId
      ? db.rulings.filter((record) => record.userId === userId)
      : db.rulings;

    const ordered = [...records].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt)
    );

    return res.json(ordered);
  });

  app.get("/api/rulings/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid ruling id" });
    }

    const record = db.rulings.find((item) => item.id === numericId);
    if (!record) {
      return res.status(404).json({ error: "Ruling not found" });
    }

    return res.json(record);
  });

  app.patch("/api/rulings/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid ruling id" });
    }

    const index = db.rulings.findIndex((item) => item.id === numericId);
    if (index < 0) {
      return res.status(404).json({ error: "Ruling not found" });
    }

    const payload = req.body as Partial<RulingRecord>;
    const current = db.rulings[index];

    db.rulings[index] = {
      ...current,
      ...payload,
      id: current.id,
      createdAt: current.createdAt,
      userId: current.userId,
    };

    await persistDb();
    return res.json(db.rulings[index]);
  });

  app.delete("/api/rulings/:id", async (req, res) => {
    const numericId = parseNumericId(req.params.id);
    if (!numericId) {
      return res.status(400).json({ error: "Invalid ruling id" });
    }

    const before = db.rulings.length;
    db.rulings = db.rulings.filter((item) => item.id !== numericId);

    if (db.rulings.length === before) {
      return res.status(404).json({ error: "Ruling not found" });
    }

    await persistDb();
    return res.status(204).send();
  });

  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), "dist");
    app.use(express.static(distPath));
    app.get("*", (_req, res) => {
      res.sendFile(path.join(distPath, "index.html"));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`JSON DB file: ${DB_PATH}`);
  });
}

startServer();
