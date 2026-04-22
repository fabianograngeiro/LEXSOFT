import React, { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Copy,
  Loader2,
  LogOut,
  Scale,
  Search,
  FileText,
  ShieldCheck,
  User,
  UserPlus,
  Trash2,
  Settings,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { analyzeCase, analyzeRuling, CaseAnalysis, findSimilarCases, generateSearchString } from './lib/gemini';
import { cn } from './lib/utils';
import { AuthProvider, useAuth, UserProfile } from './contexts/AuthContext';

type UserTab = 'analyst' | 'search' | 'ruling' | 'automation';
type SuperTab = 'users' | 'settings';

interface CaseHistoryRecord {
  id: number;
  userId: string;
  description: string;
  minutaPeca: string;
  diagnostico: string;
  estrategiaBusca: string;
  createdAt: string;
}

interface SearchHistoryRecord {
  id: number;
  userId: string;
  term: string;
  result: string;
  createdAt: string;
}

interface RulingHistoryRecord {
  id: number;
  userId: string;
  text: string;
  result: string;
  createdAt: string;
}

interface ResetChallenge {
  challengeId: string;
  tasks: Array<{ id: string; label: string }>;
}

function formatDate(dateIso?: string) {
  if (!dateIso) return '---';
  const date = new Date(dateIso);
  return Number.isNaN(date.getTime()) ? '---' : date.toLocaleDateString('pt-BR');
}

function AppContent() {
  const { user, login, logout, captcha, refreshCaptcha, refreshUser, loading: authLoading } = useAuth();

  const [hasSuperAdmin, setHasSuperAdmin] = useState<boolean | null>(null);
  const [bootLoading, setBootLoading] = useState(true);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [loginError, setLoginError] = useState<string | null>(null);
  const [loginLoading, setLoginLoading] = useState(false);

  const [setupName, setSetupName] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [setupPassword, setSetupPassword] = useState('');
  const [setupConfirmPassword, setSetupConfirmPassword] = useState('');
  const [setupCaptchaAnswer, setSetupCaptchaAnswer] = useState('');
  const [setupError, setSetupError] = useState<string | null>(null);
  const [setupLoading, setSetupLoading] = useState(false);

  const fetchAuthStatus = async () => {
    try {
      const response = await fetch('/api/auth/status');
      if (response.ok) {
        const data = await response.json();
        setHasSuperAdmin(Boolean(data.hasSuperAdmin));
      }
    } catch (err) {
      console.error('Failed to fetch auth status:', err);
      setHasSuperAdmin(true);
    }
  };

  useEffect(() => {
    const bootstrap = async () => {
      setBootLoading(true);
      await Promise.all([fetchAuthStatus(), refreshCaptcha()]);
      setBootLoading(false);
    };

    bootstrap();
  }, []);

  const handleEmailLogin = async () => {
    if (!email || !password || !captchaAnswer) {
      setLoginError('Preencha email, senha e captcha.');
      return;
    }

    setLoginLoading(true);
    setLoginError(null);

    const result = await login(email, password, captchaAnswer);
    if (!result.ok) {
      setLoginError(result.error || 'Falha no login');
    } else {
      setEmail('');
      setPassword('');
      setCaptchaAnswer('');
      await fetchAuthStatus();
    }

    setLoginLoading(false);
  };

  const handleSetupSuperAdmin = async () => {
    if (!setupName || !setupEmail || !setupPassword || !setupConfirmPassword || !setupCaptchaAnswer) {
      setSetupError('Preencha todos os campos do setup.');
      return;
    }

    if (setupPassword !== setupConfirmPassword) {
      setSetupError('As senhas nao conferem.');
      return;
    }

    if (!captcha) {
      setSetupError('Captcha indisponivel. Atualize o captcha.');
      return;
    }

    setSetupLoading(true);
    setSetupError(null);

    try {
      const response = await fetch('/api/auth/setup-superadmin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: setupName,
          email: setupEmail,
          password: setupPassword,
          captchaId: captcha.captchaId,
          captchaAnswer: setupCaptchaAnswer,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setSetupError(payload.error || 'Falha ao configurar superadmin');
        await refreshCaptcha();
        setSetupLoading(false);
        return;
      }

      localStorage.setItem('auth_user_id', payload.id);
      await refreshUser();
      await fetchAuthStatus();
      await refreshCaptcha();

      setSetupName('');
      setSetupEmail('');
      setSetupPassword('');
      setSetupConfirmPassword('');
      setSetupCaptchaAnswer('');
    } catch (err) {
      console.error('Setup failed:', err);
      setSetupError('Erro de conexao ao configurar superadmin');
      await refreshCaptcha();
    }

    setSetupLoading(false);
  };

  if (authLoading || bootLoading || hasSuperAdmin === null) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center">
        <Loader2 className="w-10 h-10 text-blue-500 animate-spin" />
      </div>
    );
  }

  if (!user && !hasSuperAdmin) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-2xl p-8 max-w-lg w-full"
        >
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Setup Inicial do Sistema</h1>
            <p className="text-sm text-slate-500 mt-1">Nenhum superadmin foi detectado. Crie a conta mestre para controlar o app.</p>
          </div>

          <div className="space-y-3">
            <input value={setupName} onChange={(e) => setSetupName(e.target.value)} placeholder="Nome do superadmin" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
            <input value={setupEmail} onChange={(e) => setSetupEmail(e.target.value)} placeholder="Email do superadmin" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
            <input type="password" value={setupPassword} onChange={(e) => setSetupPassword(e.target.value)} placeholder="Senha" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
            <input type="password" value={setupConfirmPassword} onChange={(e) => setSetupConfirmPassword(e.target.value)} placeholder="Confirmar senha" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block">Captcha</label>
                <button type="button" onClick={refreshCaptcha} className="text-[10px] font-bold text-blue-600">Atualizar</button>
              </div>
              <div className="bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-700 mb-2">
                {captcha?.question || 'Carregando captcha...'}
              </div>
              <input
                value={setupCaptchaAnswer}
                onChange={(e) => setSetupCaptchaAnswer(e.target.value)}
                placeholder="Resposta do captcha"
                className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm"
              />
            </div>

            {setupError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{setupError}</p>}

            <button
              onClick={handleSetupSuperAdmin}
              disabled={setupLoading}
              className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-60"
            >
              {setupLoading ? 'Configurando...' : 'Criar Superadmin'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#0F172A] flex items-center justify-center p-4">
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full"
        >
          <div className="text-center mb-6">
            <h1 className="text-2xl font-bold text-slate-900">Login Seguro</h1>
            <p className="text-sm text-slate-500 mt-1">Acesso por email, senha e captcha.</p>
          </div>

          <div className="space-y-3">
            <input value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Email" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
            <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="Senha" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="text-[11px] font-bold text-slate-500 uppercase tracking-widest block">Captcha</label>
                <button type="button" onClick={refreshCaptcha} className="text-[10px] font-bold text-blue-600">Atualizar</button>
              </div>
              <div className="bg-slate-100 border border-slate-200 rounded-lg px-3 py-2 text-sm font-mono text-slate-700 mb-2">
                {captcha?.question || 'Carregando captcha...'}
              </div>
              <input value={captchaAnswer} onChange={(e) => setCaptchaAnswer(e.target.value)} placeholder="Resposta do captcha" className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm" />
            </div>

            {loginError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{loginError}</p>}

            <button onClick={handleEmailLogin} disabled={loginLoading} className="w-full bg-blue-600 text-white py-3 rounded-xl font-bold hover:bg-blue-700 disabled:opacity-60">
              {loginLoading ? 'Entrando...' : 'Entrar'}
            </button>
          </div>
        </motion.div>
      </div>
    );
  }

  if (user.role === 'superadmin') {
    return <SuperAdminDashboard user={user} onLogout={logout} />;
  }

  return <RegularUserDashboard user={user} onLogout={logout} />;
}

function RegularUserDashboard({ user, onLogout }: { user: UserProfile; onLogout: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<UserTab>('analyst');
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  const [caseDescription, setCaseDescription] = useState('');
  const [caseResult, setCaseResult] = useState<CaseAnalysis | null>(null);
  const [precedents, setPrecedents] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [searchResult, setSearchResult] = useState('');
  const [rulingText, setRulingText] = useState('');
  const [rulingResult, setRulingResult] = useState('');
  const [aiError, setAiError] = useState<string | null>(null);

  const [caseHistory, setCaseHistory] = useState<CaseHistoryRecord[]>([]);
  const [searchHistory, setSearchHistory] = useState<SearchHistoryRecord[]>([]);
  const [rulingHistory, setRulingHistory] = useState<RulingHistoryRecord[]>([]);

  const fetchHistory = async () => {
    const [casesRes, searchesRes, rulingsRes] = await Promise.all([
      fetch(`/api/cases?userId=${encodeURIComponent(user.id)}`),
      fetch(`/api/searches?userId=${encodeURIComponent(user.id)}`),
      fetch(`/api/rulings?userId=${encodeURIComponent(user.id)}`),
    ]);

    if (casesRes.ok) setCaseHistory(await casesRes.json());
    if (searchesRes.ok) setSearchHistory(await searchesRes.json());
    if (rulingsRes.ok) setRulingHistory(await rulingsRes.json());
  };

  useEffect(() => {
    fetchHistory().catch((err) => console.error('Failed to fetch history:', err));
  }, [user.id]);

  const handleCopy = (text: string, key: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  };

  const handleAnalyzeCase = async () => {
    if (!caseDescription) return;
    setLoading(true);
    setAiError(null);
    try {
      const result = await analyzeCase(caseDescription);
      setCaseResult(result);
      await fetch('/api/cases', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, description: caseDescription, ...result }),
      });
      await fetchHistory();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha ao analisar caso.');
    } finally {
      setLoading(false);
    }
  };

  const handleFindSimilarCases = async () => {
    if (!caseDescription) return;
    setLoading(true);
    setAiError(null);

    try {
      const result = await findSimilarCases(caseDescription);
      setPrecedents(result);
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha ao buscar precedentes.');
    } finally {
      setLoading(false);
    }
  };

  const handleGenerateSearch = async () => {
    if (!searchTerm) return;
    setLoading(true);
    setAiError(null);
    try {
      const result = await generateSearchString(searchTerm);
      setSearchResult(result);
      await fetch('/api/searches', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, term: searchTerm, result }),
      });
      await fetchHistory();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha ao gerar string de busca.');
    } finally {
      setLoading(false);
    }
  };

  const handleAnalyzeRuling = async () => {
    if (!rulingText) return;
    setLoading(true);
    setAiError(null);
    try {
      const result = await analyzeRuling(rulingText);
      setRulingResult(result);
      await fetch('/api/rulings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, text: rulingText, result }),
      });
      await fetchHistory();
    } catch (err) {
      setAiError(err instanceof Error ? err.message : 'Falha ao analisar acórdão.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-16 bg-[#0F172A] px-6 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <Scale className="w-6 h-6" />
          <h1 className="font-semibold">Painel Jurídico</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>{user.name}</span>
          <button onClick={onLogout} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 flex items-center gap-2"><LogOut className="w-4 h-4" />Sair</button>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <TabBtn active={activeTab === 'analyst'} onClick={() => setActiveTab('analyst')} label="Analista de Caso" />
          <TabBtn active={activeTab === 'search'} onClick={() => setActiveTab('search')} label="Engenharia de Busca" />
          <TabBtn active={activeTab === 'ruling'} onClick={() => setActiveTab('ruling')} label="Analista de Acórdão" />
          <TabBtn active={activeTab === 'automation'} onClick={() => setActiveTab('automation')} label="Automações" />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <MetricCard label="Casos no banco" value={String(caseHistory.length)} />
          <MetricCard label="Buscas no banco" value={String(searchHistory.length)} />
          <MetricCard label="Acórdãos no banco" value={String(rulingHistory.length)} />
        </div>

        {aiError && (
          <div className="text-sm text-red-700 bg-red-50 border border-red-200 rounded-lg px-4 py-3">
            {aiError}
          </div>
        )}

        {activeTab === 'analyst' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <textarea value={caseDescription} onChange={(e) => setCaseDescription(e.target.value)} className="w-full h-48 p-4 border border-slate-200 rounded-xl text-sm" placeholder="Descreva o caso para análise." />
            <div className="flex gap-2">
              <button onClick={handleAnalyzeCase} disabled={loading || !caseDescription} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold">{loading ? 'Processando...' : 'Analisar Caso'}</button>
              <button onClick={handleFindSimilarCases} disabled={loading || !caseDescription} className="bg-emerald-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Buscar Precedentes</button>
            </div>
            {caseResult && (
              <div className="space-y-3">
                <ResultPanel title="Diagnóstico" content={caseResult.diagnostico} copied={copied === 'diag'} onCopy={() => handleCopy(caseResult.diagnostico, 'diag')} />
                <ResultPanel title="Estratégia de Busca" content={caseResult.estrategiaBusca} copied={copied === 'estrat'} onCopy={() => handleCopy(caseResult.estrategiaBusca, 'estrat')} />
                <div className="prose prose-sm max-w-none"><ReactMarkdown>{caseResult.minutaPeca}</ReactMarkdown></div>
              </div>
            )}
            {precedents && <div className="prose prose-sm max-w-none border-t pt-3"><ReactMarkdown>{precedents}</ReactMarkdown></div>}
          </div>
        )}

        {activeTab === 'search' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <input value={searchTerm} onChange={(e) => setSearchTerm(e.target.value)} className="w-full p-3 border border-slate-200 rounded-xl text-sm" placeholder="Tema da busca" />
            <button onClick={handleGenerateSearch} disabled={loading || !searchTerm} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">{loading ? 'Gerando...' : 'Gerar String'}</button>
            {searchResult && <ResultPanel title="String gerada" content={searchResult} copied={copied === 'search'} onCopy={() => handleCopy(searchResult, 'search')} />}
          </div>
        )}

        {activeTab === 'ruling' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 space-y-4">
            <textarea value={rulingText} onChange={(e) => setRulingText(e.target.value)} className="w-full h-48 p-4 border border-slate-200 rounded-xl text-sm" placeholder="Cole o texto do acórdão." />
            <button onClick={handleAnalyzeRuling} disabled={loading || !rulingText} className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold">{loading ? 'Analisando...' : 'Analisar Acórdão'}</button>
            {rulingResult && <div className="prose prose-sm max-w-none"><ReactMarkdown>{rulingResult}</ReactMarkdown></div>}
          </div>
        )}

        {activeTab === 'automation' && (
          <div className="bg-white rounded-xl border border-slate-200 p-5 text-sm text-slate-600">
            Scripts e automações podem ser cadastrados aqui para acelerar fluxos jurídicos.
          </div>
        )}
      </main>
    </div>
  );
}

function SuperAdminDashboard({ user, onLogout }: { user: UserProfile; onLogout: () => Promise<void> }) {
  const [activeTab, setActiveTab] = useState<SuperTab>('users');
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [showUserModal, setShowUserModal] = useState(false);
  const [editingUser, setEditingUser] = useState<UserProfile | null>(null);
  const [userFormError, setUserFormError] = useState<string | null>(null);
  const [userForm, setUserForm] = useState({
    name: '',
    email: '',
    password: '',
    role: 'defensor' as UserProfile['role'],
    org: 'DP-Geral',
    plan: 'trial' as UserProfile['plan'],
    status: 'active' as UserProfile['status'],
  });

  const [resetChallenge, setResetChallenge] = useState<ResetChallenge | null>(null);
  const [resetAnswers, setResetAnswers] = useState<Record<string, boolean>>({});
  const [resetError, setResetError] = useState<string | null>(null);
  const [resetOk, setResetOk] = useState<string | null>(null);

  const [aiProvider, setAiProvider] = useState<'gemini' | 'groq' | 'chatgpt'>('gemini');
  const [aiModel, setAiModel] = useState('');
  const [aiKey, setAiKey] = useState('');
  const [aiConfigStatus, setAiConfigStatus] = useState<string | null>(null);
  const [aiConfigError, setAiConfigError] = useState<string | null>(null);
  const [savingAiConfig, setSavingAiConfig] = useState(false);

  const authHeader = useMemo(() => ({ 'x-user-id': user.id, 'Content-Type': 'application/json' }), [user.id]);

  const fetchUsers = async () => {
    setLoadingUsers(true);
    try {
      const response = await fetch('/api/superadmin/users', { headers: { 'x-user-id': user.id } });
      if (response.ok) {
        setUsers(await response.json());
      }
    } catch (err) {
      console.error('Failed to fetch users:', err);
    }
    setLoadingUsers(false);
  };

  const fetchAiConfig = async () => {
    try {
      const response = await fetch('/api/superadmin/ai-config', {
        headers: { 'x-user-id': user.id },
      });

      if (!response.ok) {
        return;
      }

      const payload = await response.json();
      setAiProvider(payload.provider || 'gemini');
      setAiModel(payload.model || '');
      setAiConfigStatus(payload.hasKey ? 'Chave global configurada.' : 'Nenhuma chave global configurada.');
    } catch (err) {
      console.error('Failed to fetch AI config:', err);
    }
  };

  useEffect(() => {
    fetchUsers();
    fetchAiConfig();
  }, []);

  const saveAiConfig = async () => {
    setSavingAiConfig(true);
    setAiConfigStatus(null);
    setAiConfigError(null);

    try {
      const response = await fetch('/api/superadmin/ai-config', {
        method: 'PATCH',
        headers: authHeader,
        body: JSON.stringify({
          provider: aiProvider,
          model: aiModel,
          apiKey: aiKey,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        setAiConfigError(payload.error || 'Falha ao salvar configuração de IA.');
        setSavingAiConfig(false);
        return;
      }

      setAiKey('');
      setAiConfigStatus('Configuração global de IA salva com sucesso.');
      setAiModel(payload.model || aiModel);
    } catch (err) {
      console.error('Failed to save AI config:', err);
      setAiConfigError('Falha de conexão ao salvar configuração de IA.');
    }

    setSavingAiConfig(false);
  };

  const saveUser = async () => {
    setUserFormError(null);

    if (!userForm.name.trim() || !userForm.email.trim()) {
      setUserFormError('Nome e email são obrigatórios.');
      return;
    }

    if (!editingUser && !userForm.password.trim()) {
      setUserFormError('Senha é obrigatória para criar novo usuário.');
      return;
    }

    if (userForm.password && userForm.password.length < 8) {
      setUserFormError('A senha deve ter no mínimo 8 caracteres.');
      return;
    }

    const isEdit = Boolean(editingUser);
    const url = isEdit ? `/api/superadmin/users/${editingUser?.id}` : '/api/superadmin/users';
    const method = isEdit ? 'PATCH' : 'POST';

    const response = await fetch(url, {
      method,
      headers: authHeader,
      body: JSON.stringify(userForm),
    });

    const payload = await response.json().catch(() => null);

    if (!response.ok) {
      setUserFormError(payload?.error || 'Falha ao salvar usuário. Verifique os dados e tente novamente.');
      return;
    }

    setShowUserModal(false);
    setEditingUser(null);
    setUserFormError(null);
    setUserForm({ name: '', email: '', password: '', role: 'defensor', org: 'DP-Geral', plan: 'trial', status: 'active' });
    await fetchUsers();
  };

  const deleteUser = async (id: string) => {
    if (!confirm('Deseja remover este usuário do sistema?')) return;

    const response = await fetch(`/api/superadmin/users/${id}`, {
      method: 'DELETE',
      headers: { 'x-user-id': user.id },
    });

    if (response.ok) {
      await fetchUsers();
    }
  };

  const startResetChallenge = async () => {
    setResetError(null);
    setResetOk(null);

    const response = await fetch('/api/superadmin/reset-challenge', {
      headers: { 'x-user-id': user.id },
    });

    if (!response.ok) {
      setResetError('Falha ao iniciar mini-game de segurança.');
      return;
    }

    const challenge = await response.json();
    setResetChallenge(challenge);
    setResetAnswers({});
  };

  const confirmReset = async () => {
    if (!resetChallenge) {
      return;
    }

    setResetError(null);
    setResetOk(null);

    const response = await fetch('/api/superadmin/reset-app', {
      method: 'POST',
      headers: authHeader,
      body: JSON.stringify({
        challengeId: resetChallenge.challengeId,
        answers: resetAnswers,
      }),
    });

    const payload = await response.json();
    if (!response.ok) {
      setResetError(payload.error || 'Falha ao redefinir sistema');
      return;
    }

    setResetOk('Sistema redefinido. Faça novo setup do superadmin.');
    localStorage.removeItem('auth_user_id');
    await onLogout();
    window.location.reload();
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="h-16 bg-[#0F172A] px-6 flex items-center justify-between text-white">
        <div className="flex items-center gap-3">
          <ShieldCheck className="w-6 h-6" />
          <h1 className="font-semibold">Painel Superadmin</h1>
        </div>
        <div className="flex items-center gap-3 text-sm">
          <span>{user.name}</span>
          <button onClick={onLogout} className="px-3 py-1.5 rounded bg-white/10 hover:bg-white/20 flex items-center gap-2"><LogOut className="w-4 h-4" />Sair</button>
        </div>
      </header>

      <main className="p-6 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <TabBtn active={activeTab === 'users'} onClick={() => setActiveTab('users')} label="Gerenciar Usuários" />
          <TabBtn active={activeTab === 'settings'} onClick={() => setActiveTab('settings')} label="Configurações" />
        </div>

        {activeTab === 'users' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">Usuários do Sistema</h2>
              <button
                onClick={() => {
                  setEditingUser(null);
                  setUserFormError(null);
                  setUserForm({ name: '', email: '', password: '', role: 'defensor', org: 'DP-Geral', plan: 'trial', status: 'active' });
                  setShowUserModal(true);
                }}
                className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold flex items-center gap-2"
              >
                <UserPlus className="w-4 h-4" />
                Novo Usuário
              </button>
            </div>

            {loadingUsers ? (
              <div className="py-10 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-slate-400" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left">
                  <thead>
                    <tr className="border-b border-slate-200 text-[11px] uppercase text-slate-400">
                      <th className="py-2">Nome</th>
                      <th className="py-2">Email</th>
                      <th className="py-2">Role</th>
                      <th className="py-2">Status</th>
                      <th className="py-2 text-right">Ações</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map((entry) => (
                      <tr key={entry.id} className="border-b border-slate-100">
                        <td className="py-3 text-sm font-medium text-slate-800">{entry.name}</td>
                        <td className="py-3 text-sm text-slate-600">{entry.email}</td>
                        <td className="py-3 text-sm text-slate-600 uppercase">{entry.role}</td>
                        <td className="py-3 text-sm text-slate-600 uppercase">{entry.status}</td>
                        <td className="py-3 text-right">
                          <button
                            onClick={() => {
                              setEditingUser(entry);
                              setUserFormError(null);
                              setUserForm({
                                name: entry.name,
                                email: entry.email,
                                password: '',
                                role: entry.role,
                                org: entry.org,
                                plan: entry.plan,
                                status: entry.status,
                              });
                              setShowUserModal(true);
                            }}
                            className="text-blue-600 text-sm font-medium mr-3"
                          >
                            Editar
                          </button>
                          <button onClick={() => deleteUser(entry.id)} className="text-red-600 text-sm font-medium inline-flex items-center gap-1">
                            <Trash2 className="w-4 h-4" />Remover
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {activeTab === 'settings' && (
          <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
            <h2 className="text-lg font-bold text-slate-800 flex items-center gap-2"><Settings className="w-5 h-5" />Configurações de Sistema</h2>
            <div className="border border-slate-200 rounded-lg p-4 space-y-3">
              <h3 className="text-sm font-bold text-slate-800">Chave global da IA</h3>
              <p className="text-xs text-slate-500">Defina o provedor e a chave que serão usados globalmente por todo o app.</p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                <select value={aiProvider} onChange={(e) => setAiProvider(e.target.value as 'gemini' | 'groq' | 'chatgpt')} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm">
                  <option value="gemini">Gemini</option>
                  <option value="groq">Groq</option>
                  <option value="chatgpt">ChatGPT</option>
                </select>
                <input value={aiModel} onChange={(e) => setAiModel(e.target.value)} placeholder="Modelo (ex: gemini-2.0-flash, llama-3.3-70b-versatile, gpt-4o-mini)" className="w-full p-2.5 border border-slate-200 rounded-lg text-sm" />
              </div>

              <input
                type="password"
                value={aiKey}
                onChange={(e) => setAiKey(e.target.value)}
                placeholder="Cole a API key global (Gemini/Groq/ChatGPT)"
                className="w-full p-2.5 border border-slate-200 rounded-lg text-sm"
              />

              <button onClick={saveAiConfig} disabled={savingAiConfig} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60">
                {savingAiConfig ? 'Salvando...' : 'Salvar configuração global'}
              </button>

              {aiConfigStatus && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{aiConfigStatus}</p>}
              {aiConfigError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{aiConfigError}</p>}
            </div>

            <p className="text-sm text-slate-600">Redefinir para padrão de fábrica remove toda a database local.</p>

            {!resetChallenge && (
              <button onClick={startResetChallenge} className="bg-amber-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Iniciar Mini-game de Segurança</button>
            )}

            {resetChallenge && (
              <div className="space-y-3 border border-amber-200 bg-amber-50 rounded-lg p-4">
                <p className="text-sm font-bold text-amber-800">Resolva os 3 checkbox captcha para liberar o reset:</p>
                {resetChallenge.tasks.map((task) => (
                  <label key={task.id} className="flex items-center gap-2 text-sm text-amber-900">
                    <input
                      type="checkbox"
                      checked={Boolean(resetAnswers[task.id])}
                      onChange={(e) => setResetAnswers((prev) => ({ ...prev, [task.id]: e.target.checked }))}
                    />
                    <span>{task.label}</span>
                  </label>
                ))}
                <div className="flex gap-2 pt-2">
                  <button onClick={confirmReset} className="bg-red-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Apagar Sistema</button>
                  <button onClick={() => setResetChallenge(null)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold">Cancelar</button>
                </div>
              </div>
            )}

            {resetError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{resetError}</p>}
            {resetOk && <p className="text-xs text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{resetOk}</p>}
          </div>
        )}
      </main>

      <AnimatePresence>
        {showUserModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="absolute inset-0 bg-slate-900/60" onClick={() => setShowUserModal(false)} />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }} className="relative z-10 bg-white rounded-xl border border-slate-200 p-5 w-full max-w-md space-y-3">
              <h3 className="text-lg font-bold text-slate-800">{editingUser ? 'Editar Usuário' : 'Novo Usuário'}</h3>
              <input value={userForm.name} onChange={(e) => setUserForm((prev) => ({ ...prev, name: e.target.value }))} placeholder="Nome" className="w-full p-2.5 border border-slate-200 rounded-lg text-sm" />
              <input value={userForm.email} onChange={(e) => setUserForm((prev) => ({ ...prev, email: e.target.value }))} placeholder="Email" className="w-full p-2.5 border border-slate-200 rounded-lg text-sm" />
              <input type="password" value={userForm.password} onChange={(e) => setUserForm((prev) => ({ ...prev, password: e.target.value }))} placeholder={editingUser ? 'Nova senha (opcional)' : 'Senha'} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm" />
              {userFormError && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{userFormError}</p>}
              <div className="grid grid-cols-2 gap-2">
                <select value={userForm.role} onChange={(e) => setUserForm((prev) => ({ ...prev, role: e.target.value as UserProfile['role'] }))} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm">
                  <option value="superadmin">superadmin</option>
                  <option value="admin">admin</option>
                  <option value="defensor">defensor</option>
                  <option value="analista">analista</option>
                </select>
                <select value={userForm.status} onChange={(e) => setUserForm((prev) => ({ ...prev, status: e.target.value as UserProfile['status'] }))} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm">
                  <option value="active">active</option>
                  <option value="pending">pending</option>
                  <option value="suspended">suspended</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <input value={userForm.org} onChange={(e) => setUserForm((prev) => ({ ...prev, org: e.target.value }))} placeholder="Orgão" className="w-full p-2.5 border border-slate-200 rounded-lg text-sm" />
                <select value={userForm.plan} onChange={(e) => setUserForm((prev) => ({ ...prev, plan: e.target.value as UserProfile['plan'] }))} className="w-full p-2.5 border border-slate-200 rounded-lg text-sm">
                  <option value="trial">trial</option>
                  <option value="pro">pro</option>
                  <option value="enterprise">enterprise</option>
                </select>
              </div>
              <div className="flex gap-2 pt-2">
                <button onClick={saveUser} className="bg-blue-600 text-white px-4 py-2 rounded-lg text-sm font-bold">Salvar</button>
                <button onClick={() => setShowUserModal(false)} className="bg-slate-200 text-slate-700 px-4 py-2 rounded-lg text-sm font-bold">Cancelar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}

function TabBtn({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left px-3 py-2 rounded-lg text-sm border transition-colors',
        active ? 'bg-blue-600 border-blue-600 text-white' : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
      )}
    >
      {label}
    </button>
  );
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white border border-slate-200 p-4 rounded-xl">
      <p className="text-[10px] uppercase tracking-widest text-slate-400 font-bold">{label}</p>
      <p className="text-2xl font-bold text-slate-800 mt-1">{value}</p>
    </div>
  );
}

function ResultPanel({ title, content, onCopy, copied }: { title: string; content: string; onCopy: () => void; copied: boolean }) {
  return (
    <div className="border border-slate-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        <button onClick={onCopy} className="text-slate-500 hover:text-slate-700">
          {copied ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
        </button>
      </div>
      <p className="text-sm text-slate-700 whitespace-pre-wrap">{content}</p>
    </div>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppContent />
    </AuthProvider>
  );
}
