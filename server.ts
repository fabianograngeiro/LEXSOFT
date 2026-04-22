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
  aiConfig: AiConfig;
  counters: {
    caseId: number;
    searchId: number;
    rulingId: number;
  };
}

interface CheckboxCaptchaTask {
  id: string;
  label: string;
  expected: boolean;
}

const initialDB: JsonDB = {
  users: [],
  cases: [],
  searches: [],
  rulings: [],
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
  },
};

let db: JsonDB = structuredClone(initialDB);
let writeQueue = Promise.resolve();
const captchaStore = new Map<string, { answer: string; expiresAt: number }>();
const resetChallengeStore = new Map<
  string,
  { tasks: CheckboxCaptchaTask[]; expiresAt: number }
>();

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

async function callAiProvider(prompt: string, responseAsJson = false) {
  const provider = db.aiConfig.provider;
  const model = db.aiConfig.model || defaultModelForProvider(provider);
  const apiKey = db.aiConfig.apiKey;

  if (!apiKey) {
    throw new Error("AI provider not configured. Set API key in superadmin settings.");
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
      throw new Error(`Gemini error: ${response.status} ${body}`);
    }

    const payload = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
    };

    return payload.candidates?.[0]?.content?.parts?.[0]?.text || "";
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
    throw new Error(`${provider} error: ${response.status} ${body}`);
  }

  const payload = (await response.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };

  return payload.choices?.[0]?.message?.content || "";
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
      const text = await callAiProvider(prompt, true);
      const parsed = JSON.parse(text || "{}");
      return res.json({
        diagnostico: parsed.diagnostico || "",
        estrategiaBusca: parsed.estrategiaBusca || "",
        sugestaoAutomacao: parsed.sugestaoAutomacao || "",
        minutaPeca: parsed.minutaPeca || "",
      });
    } catch (error) {
      console.error("AI analyze-case failed:", error);
      return res.status(500).json({ error: "Falha ao processar IA para caso" });
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
      const text = await callAiProvider(prompt);
      return res.json({ result: text || "" });
    } catch (error) {
      console.error("AI generate-search failed:", error);
      return res.status(500).json({ error: "Falha ao gerar string de busca" });
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
      const text = await callAiProvider(prompt);
      return res.json({ result: text || "" });
    } catch (error) {
      console.error("AI analyze-ruling failed:", error);
      return res.status(500).json({ error: "Falha ao analisar acordao" });
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
      const text = await callAiProvider(prompt);
      return res.json({ result: text || "" });
    } catch (error) {
      console.error("AI similar-cases failed:", error);
      return res.status(500).json({ error: "Falha ao buscar precedentes" });
    }
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
