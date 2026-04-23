import { useEffect, useMemo, useState } from 'react';
import { Loader2, Plus, Trash2 } from 'lucide-react';
import ReactMarkdown from 'react-markdown';

interface AnalystToolOutput {
  tool: string;
  content: string;
}

interface AnalystChatMessage {
  id: number;
  role: 'user' | 'assistant';
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

interface SideCardState {
  precedentsWeb: string | null;
  nullities: string | null;
  trendAnalysis: string | null;
}

interface AnalystChatSummary {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  lastMessagePreview: string;
  messagesCount: number;
}

function formatDateTime(dateIso?: string) {
  if (!dateIso) return '---';
  const date = new Date(dateIso);
  return Number.isNaN(date.getTime()) ? '---' : date.toLocaleString('pt-BR');
}

export default function AnalystChatPanel({ userId }: { userId: string }) {
  const [chats, setChats] = useState<AnalystChatSummary[]>([]);
  const [activeChat, setActiveChat] = useState<AnalystChatRecord | null>(null);
  const [draft, setDraft] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingChats, setLoadingChats] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const sideCards = useMemo<SideCardState>(() => {
    const base: SideCardState = {
      precedentsWeb: null,
      nullities: null,
      trendAnalysis: null,
    };

    if (!activeChat) {
      return base;
    }

    for (const msg of activeChat.messages) {
      if (!Array.isArray(msg.toolOutputs)) continue;
      for (const tool of msg.toolOutputs) {
        if (tool.tool === 'precedents_web_card') {
          base.precedentsWeb = tool.content;
        }
        if (tool.tool === 'nullities_card') {
          base.nullities = tool.content;
        }
        if (tool.tool === 'trend_analysis_card') {
          base.trendAnalysis = tool.content;
        }
      }
    }

    return base;
  }, [activeChat]);

  const authHeaders = useMemo(
    () => ({ 'Content-Type': 'application/json', 'x-user-id': userId }),
    [userId]
  );

  const fetchChats = async () => {
    setLoadingChats(true);
    try {
      const response = await fetch('/api/analyst-chats', {
        headers: { 'x-user-id': userId },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || 'Falha ao carregar chats do analista.');
        setLoadingChats(false);
        return;
      }

      const list = Array.isArray(payload) ? (payload as AnalystChatSummary[]) : [];
      setChats(list);

      if (list.length === 0) {
        setActiveChat(null);
      } else if (!activeChat || !list.some((entry) => entry.id === activeChat.id)) {
        await openChat(list[0].id);
      }

      setError(null);
    } catch {
      setError('Falha de conexão ao carregar chats do analista.');
    }
    setLoadingChats(false);
  };

  const openChat = async (chatId: number) => {
    try {
      const response = await fetch(`/api/analyst-chats/${chatId}`, {
        headers: { 'x-user-id': userId },
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || 'Falha ao abrir chat.');
        return;
      }

      setActiveChat(payload as AnalystChatRecord);
      setError(null);
    } catch {
      setError('Falha de conexão ao abrir chat.');
    }
  };

  useEffect(() => {
    fetchChats();
  }, [userId]);

  const createChat = async () => {
    if (!draft.trim()) {
      setError('Digite a primeira mensagem para criar o chat.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/analyst-chats', {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: draft.trim() }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || 'Falha ao criar chat.');
        setLoading(false);
        return;
      }

      setDraft('');
      setActiveChat(payload as AnalystChatRecord);
      await fetchChats();
      setError(null);
    } catch {
      setError('Falha de conexão ao criar chat.');
    }
    setLoading(false);
  };

  const sendMessage = async () => {
    if (!activeChat) {
      await createChat();
      return;
    }

    if (!draft.trim()) {
      return;
    }

    setLoading(true);
    try {
      const response = await fetch(`/api/analyst-chats/${activeChat.id}/messages`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ message: draft.trim() }),
      });

      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        setError(payload?.error || 'Falha ao enviar mensagem para o chat.');
        setLoading(false);
        return;
      }

      setDraft('');
      setActiveChat(payload as AnalystChatRecord);
      await fetchChats();
      setError(null);
    } catch {
      setError('Falha de conexão ao enviar mensagem.');
    }
    setLoading(false);
  };

  const deleteChat = async (chatId: number) => {
    if (!confirm('Deseja excluir este chat do analista?')) return;

    try {
      const response = await fetch(`/api/analyst-chats/${chatId}`, {
        method: 'DELETE',
        headers: { 'x-user-id': userId },
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => null);
        setError(payload?.error || 'Falha ao excluir chat.');
        return;
      }

      if (activeChat?.id === chatId) {
        setActiveChat(null);
      }

      await fetchChats();
      setError(null);
    } catch {
      setError('Falha de conexão ao excluir chat.');
    }
  };

  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="grid grid-cols-1 xl:grid-cols-[1fr_320px_320px] gap-4">
        <div className="border border-slate-200 rounded-lg p-3 flex flex-col min-h-[520px]">
          <div className="mb-3">
            <h3 className="text-sm font-bold text-slate-800">Chat do Analista com Tools</h3>
            <p className="text-xs text-slate-500">Use este chat para aprofundar o caso com mensagens sequenciais. A IA pode usar tools para documento completo, precedentes e estratégia de busca.</p>
          </div>

          <div className="flex-1 overflow-auto border border-slate-200 rounded-lg p-3 space-y-3 bg-slate-50">
            {activeChat?.messages?.length ? (
              activeChat.messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`rounded-lg p-3 border text-sm ${msg.role === 'assistant' ? 'bg-white border-slate-200' : 'bg-blue-600 text-white border-blue-600'}`}
                >
                  <div className="text-[10px] uppercase tracking-wide mb-1 opacity-70">
                    {msg.role === 'assistant' ? 'Assistente' : 'Você'} • {formatDateTime(msg.createdAt)}
                  </div>

                  {msg.role === 'assistant' ? (
                    <div className="prose prose-sm max-w-none">
                      <ReactMarkdown>{msg.content || ''}</ReactMarkdown>
                    </div>
                  ) : (
                    <p className="whitespace-pre-wrap">{msg.content}</p>
                  )}

                  {msg.thinking && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-xs font-semibold text-slate-600">Mostrar pensamento resumido</summary>
                      <p className="mt-1 text-xs text-slate-600 whitespace-pre-wrap">{msg.thinking}</p>
                    </details>
                  )}

                  {Array.isArray(msg.toolOutputs) && msg.toolOutputs.length > 0 && (
                    <div className="mt-3 space-y-2">
                      {msg.toolOutputs.map((tool, idx) => (
                        <div key={`${msg.id}-${tool.tool}-${idx}`} className="border border-slate-200 rounded p-2 bg-slate-100">
                          <p className="text-[10px] uppercase tracking-wide font-bold text-slate-600">Tool: {tool.tool}</p>
                          <div className="prose prose-sm max-w-none text-slate-700">
                            <ReactMarkdown>{tool.content}</ReactMarkdown>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-sm text-slate-500">Nenhum chat aberto. Envie a primeira mensagem para iniciar.</p>
            )}
          </div>

          <div className="mt-3 space-y-2">
            <textarea
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              className="w-full h-28 p-3 border border-slate-200 rounded-lg text-sm"
              placeholder="Descreva o caso ou envie mais informações para continuar o chat..."
            />
            <div className="flex gap-2">
              <button
                onClick={activeChat ? sendMessage : createChat}
                disabled={loading || !draft.trim()}
                className="bg-slate-900 text-white px-4 py-2 rounded-lg text-sm font-bold disabled:opacity-60"
              >
                {loading ? 'Processando...' : activeChat ? 'Enviar mensagem' : 'Criar chat'}
              </button>
            </div>
          </div>

          {error && <p className="mt-2 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
        </div>

        <aside className="border border-slate-200 rounded-lg p-3 flex flex-col min-h-[520px]">
          <h3 className="text-sm font-bold text-slate-800 mb-3">Cards ativados pela IA</h3>

          <div className="flex-1 overflow-auto space-y-3">
            {!sideCards.precedentsWeb && !sideCards.nullities && !sideCards.trendAnalysis && (
              <p className="text-xs text-slate-500">A IA ainda nao ativou cards laterais para este chat.</p>
            )}

            {sideCards.precedentsWeb && (
              <div className="border border-emerald-200 rounded-lg bg-emerald-50 p-3">
                <p className="text-xs font-bold text-emerald-800 uppercase tracking-wide">Precedentes (Web)</p>
                <div className="prose prose-sm max-w-none text-slate-700 mt-2">
                  <ReactMarkdown>{sideCards.precedentsWeb}</ReactMarkdown>
                </div>
              </div>
            )}

            {sideCards.nullities && (
              <div className="border border-amber-200 rounded-lg bg-amber-50 p-3">
                <p className="text-xs font-bold text-amber-800 uppercase tracking-wide">Nulidades</p>
                <div className="prose prose-sm max-w-none text-slate-700 mt-2">
                  <ReactMarkdown>{sideCards.nullities}</ReactMarkdown>
                </div>
              </div>
            )}

            {sideCards.trendAnalysis && (
              <div className="border border-indigo-200 rounded-lg bg-indigo-50 p-3">
                <p className="text-xs font-bold text-indigo-800 uppercase tracking-wide">Analise de Tendencia</p>
                <div className="prose prose-sm max-w-none text-slate-700 mt-2">
                  <ReactMarkdown>{sideCards.trendAnalysis}</ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </aside>

        <aside className="border border-slate-200 rounded-lg p-3 flex flex-col min-h-[520px]">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-bold text-slate-800">Chats</h3>
            <button
              onClick={() => {
                setActiveChat(null);
                setDraft('');
              }}
              className="inline-flex items-center gap-1 bg-blue-600 text-white px-2 py-1 rounded text-xs font-bold"
            >
              <Plus className="w-3.5 h-3.5" /> Novo
            </button>
          </div>

          <div className="flex-1 overflow-auto space-y-2">
            {loadingChats && (
              <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
            )}

            {!loadingChats && chats.length === 0 && (
              <p className="text-xs text-slate-500">Nenhum chat criado ainda.</p>
            )}

            {chats.map((chat) => (
              <div
                key={chat.id}
                className={`border rounded-lg p-2 ${activeChat?.id === chat.id ? 'border-blue-500 bg-blue-50' : 'border-slate-200 bg-white'}`}
              >
                <button onClick={() => openChat(chat.id)} className="w-full text-left">
                  <p className="text-sm font-semibold text-slate-800 truncate">{chat.title}</p>
                  <p className="text-xs text-slate-500 truncate">{chat.lastMessagePreview || 'Sem mensagens'}</p>
                  <p className="text-[10px] text-slate-400 mt-1">{formatDateTime(chat.updatedAt)}</p>
                </button>
                <button
                  onClick={() => deleteChat(chat.id)}
                  className="mt-2 text-xs text-red-600 inline-flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Excluir
                </button>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}
