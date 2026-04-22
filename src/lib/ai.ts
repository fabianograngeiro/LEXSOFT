export interface CaseAnalysis {
  diagnostico: string;
  estrategiaBusca: string;
  sugestaoAutomacao: string;
  minutaPeca: string;
}

function authHeaders() {
  const userId = localStorage.getItem('auth_user_id') || '';
  return {
    'Content-Type': 'application/json',
    'x-user-id': userId,
  };
}

async function throwApiError(response: Response, fallback: string): Promise<never> {
  let message = fallback;
  try {
    const payload = await response.json();
    if (payload?.error) {
      message = String(payload.error);
    }
  } catch {
    // ignore parse issues and use fallback message
  }

  throw new Error(message);
}

export async function analyzeCase(description: string): Promise<CaseAnalysis> {
  const response = await fetch('/api/ai/analyze-case', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ description }),
  });

  if (!response.ok) {
    await throwApiError(response, 'Falha ao analisar caso com IA');
  }

  const payload = await response.json();

  return {
    diagnostico: payload.diagnostico || '',
    estrategiaBusca: payload.estrategiaBusca || '',
    sugestaoAutomacao: payload.sugestaoAutomacao || '',
    minutaPeca: payload.minutaPeca || '',
  };
}

export async function generateSearchString(theme: string): Promise<string> {
  const response = await fetch('/api/ai/generate-search', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ theme }),
  });

  if (!response.ok) {
    await throwApiError(response, 'Falha ao gerar string de busca');
  }

  const payload = await response.json();
  return payload.result || '';
}

export async function analyzeRuling(rulingText: string): Promise<string> {
  const response = await fetch('/api/ai/analyze-ruling', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ rulingText }),
  });

  if (!response.ok) {
    await throwApiError(response, 'Falha ao analisar acordao');
  }

  const payload = await response.json();
  return payload.result || '';
}

export async function findSimilarCases(description: string): Promise<string> {
  const response = await fetch('/api/ai/find-similar-cases', {
    method: 'POST',
    headers: authHeaders(),
    body: JSON.stringify({ description }),
  });

  if (!response.ok) {
    await throwApiError(response, 'Falha ao buscar precedentes');
  }

  const payload = await response.json();
  return payload.result || 'Nenhum precedente similar encontrado via IA.';
}