require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

app.use(express.static(path.join(__dirname, 'css')));
app.use(express.static(path.join(__dirname, 'js')));

// Serve arquivos estáticos (index.html, css/ e js/)
app.use(express.static(path.join(__dirname)));

const TOKEN = process.env.TINY_TOKEN;
const TINY_MIN_INTERVAL_MS = Math.max(0, Number(process.env.TINY_MIN_INTERVAL_MS || 250));
const TINY_MAX_RETRIES = Math.max(0, Number(process.env.TINY_MAX_RETRIES || 4));
const TINY_RETRY_BASE_MS = Math.max(100, Number(process.env.TINY_RETRY_BASE_MS || 800));
const TINY_RETRY_MAX_DELAY_MS = Math.max(1000, Number(process.env.TINY_RETRY_MAX_DELAY_MS || 15000));

let tinyRequestQueue = Promise.resolve();
let tinyLastRequestStartedAt = 0;

// Extrai texto descritivo de categorias retornadas pelo Tiny
function extrairCategoriaTiny(value) {
  if (!value) return '';

  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => extrairCategoriaTiny(item))
      .filter(Boolean)
      .join(' ');
  }

  if (typeof value === 'object') {
    return [
      value.descricao,
      value.nome,
      value.categoria,
      value.descricaoCategoria,
      value.nomeCategoria,
      value.caminhoCompleto,
      value.descricaoCompleta,
      value.pai,
      value.filhos
    ]
      .map((item) => extrairCategoriaTiny(item))
      .filter(Boolean)
      .join(' ');
  }

  return String(value);
}

// Converte valores de custo vindos do Tiny para número (aceita '.', ',')
function parseCustoTiny(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const raw = String(value).trim();
  if (!raw) return 0;

  // Aceita formatos como "8.99", "8,99", "1.234,56" e "1234.56".
  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  const normalized = raw
    .replace(/R\$\s?/gi, '')
    .replace(/\s+/g, '')
    .replace(/\./g, '')
    .replace(',', '.');

  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseEstoqueTiny(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;

  const raw = String(value).trim();
  if (!raw) return null;

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  }

  if (/^-?\d+(,\d+)?$/.test(raw)) {
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

async function mapWithConcurrency(items, limit, worker) {
  const list = Array.isArray(items) ? items : [];
  if (list.length === 0) return [];

  const results = new Array(list.length);
  const concurrency = Math.max(1, Math.min(Number(limit) || 1, list.length));
  let nextIndex = 0;

  async function runner() {
    while (nextIndex < list.length) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      results[currentIndex] = await worker(list[currentIndex], currentIndex);
    }
  }

  await Promise.all(Array.from({ length: concurrency }, () => runner()));
  return results;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeText(value) {
  return String(value || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function extractTinyErrorMessage(payload) {
  const retorno = payload?.retorno || payload?.response?.data?.retorno || {};
  return String(
    retorno?.erros?.[0]?.erro
    || retorno?.erros?.[0]?.mensagem
    || retorno?.erro
    || payload?.erro
    || payload?.message
    || ''
  );
}

function isTinyBlockedMessage(message) {
  const normalized = normalizeText(message);
  return normalized.includes('api bloqueada')
    || normalized.includes('excedido o numero de acessos a api')
    || normalized.includes('aguarde alguns minutos e tente novamente');
}

function isTinyBlockedError(error) {
  const status = Number(error?.response?.status || 0);
  if (status === 429 || status === 423) return true;

  const message = extractTinyErrorMessage(error?.response?.data || error);
  return isTinyBlockedMessage(message);
}

function getTinyRetryDelayMs(attempt) {
  const expBackoff = TINY_RETRY_BASE_MS * (2 ** attempt);
  const jitter = Math.floor(Math.random() * 300);
  return Math.min(expBackoff + jitter, TINY_RETRY_MAX_DELAY_MS);
}

async function enqueueTinyRequest(requestFn) {
  const run = tinyRequestQueue.then(async () => {
    const elapsed = Date.now() - tinyLastRequestStartedAt;
    if (elapsed < TINY_MIN_INTERVAL_MS) {
      await wait(TINY_MIN_INTERVAL_MS - elapsed);
    }
    tinyLastRequestStartedAt = Date.now();
    return await requestFn();
  });

  // Mantem a fila viva mesmo se uma chamada falhar.
  tinyRequestQueue = run.catch(() => undefined);
  return run;
}

async function tinyGet(url, params, options = {}) {
  const maxRetries = Number.isFinite(options.maxRetries)
    ? Math.max(0, Number(options.maxRetries))
    : TINY_MAX_RETRIES;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    try {
      const response = await enqueueTinyRequest(() => axios.get(url, { params }));

      const retorno = response?.data?.retorno || {};
      const statusRetorno = normalizeText(retorno?.status);
      if (statusRetorno === 'erro') {
        const erroMsg = extractTinyErrorMessage(response?.data);
        if (isTinyBlockedMessage(erroMsg)) {
          if (attempt < maxRetries) {
            await wait(getTinyRetryDelayMs(attempt));
            continue;
          }

          const blockedError = new Error('API do Tiny indisponivel temporariamente por limite de acessos.');
          blockedError.code = 'TINY_RATE_LIMITED';
          blockedError.tinyBlocked = true;
          throw blockedError;
        }
      }

      return response;
    } catch (error) {
      const shouldRetry = (isTinyBlockedError(error) || isTinyUnavailableError(error)) && attempt < maxRetries;
      if (!shouldRetry) {
        throw error;
      }

      await wait(getTinyRetryDelayMs(attempt));
    }
  }

  throw new Error('Falha ao consultar Tiny apos tentativas de retry.');
}

function isTinyUnavailableError(error) {
  if (!error) return false;

  const code = String(error.code || '').toUpperCase();
  const knownNetworkCodes = new Set([
    'ECONNABORTED',
    'ECONNREFUSED',
    'ECONNRESET',
    'ENOTFOUND',
    'EAI_AGAIN',
    'ETIMEDOUT'
  ]);

  if (knownNetworkCodes.has(code)) return true;

  const status = Number(error.response?.status);
  return Number.isFinite(status) && status >= 500;
}

// Busca Produto via endpoint de pesquisa do Tiny e retorna o melhor candidato
async function buscarProdutoPorTermo(term) {
  const pesquisaResponse = await tinyGet('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
    token: TOKEN,
    pesquisa: term,
    formato: 'json'
  });

  const produtos = pesquisaResponse?.data?.retorno?.produtos || [];
  if (!Array.isArray(produtos) || produtos.length === 0) return null;

  const normalizedTerm = String(term || '').toLowerCase();
  const mapped = produtos.map((item) => {
    const produto = item.produto || {};
    return {
      id: produto.id,
      codigo: String(produto.codigo || '').toLowerCase(),
      nome: String(produto.descricao || produto.nome || produto.titulo || '').toLowerCase()
    };
  });

  function scoreItem(candidate) {
    if (!candidate) return 0;
    const codigo = candidate.codigo || '';
    const nome = candidate.nome || '';
    let score = 0;
    if (codigo === normalizedTerm) score += 1000;
    if (codigo && normalizedTerm && codigo.startsWith(normalizedTerm)) score += 800;
    if (codigo && normalizedTerm && codigo.includes(normalizedTerm)) score += 600;
    if (nome && normalizedTerm && nome.includes(normalizedTerm)) score += 400;
    return score;
  }

  let best = mapped[0];
  let bestScore = scoreItem(best);

  for (const candidate of mapped) {
    const score = scoreItem(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  return best && best.id ? best : mapped[0];
}

// Retorna o objeto `produto` completo a partir do ID (produto.obter)
async function obterProdutoTinyPorId(id) {
  const produtoResponse = await tinyGet('https://api.tiny.com.br/api2/produto.obter.php', {
    token: TOKEN,
    id,
    formato: 'json'
  });

  return produtoResponse?.data?.retorno?.produto || null;
}

// Wrapper simples para buscar produto completo por ID (mesma função que obterProdutoTinyPorId)
// Mantido para clareza de uso no fluxo de atualização.
async function obterProdutoPorId(id) {
  return await obterProdutoTinyPorId(id);
}



// Busca produto pelo SKU: pesquisa e depois obtém o objeto completo
async function buscarProdutoPorSKU(sku) {
  const productCandidate = await buscarProdutoPorTermo(sku);
  if (!productCandidate || !productCandidate.id) return null;

  const produto = await obterProdutoTinyPorId(productCandidate.id);
  if (!produto) return null;

  if (!produto.id) {
    produto.id = productCandidate.id;
  }

  return produto;
}

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

app.get('/estoque-reservado', (req, res) => {
  res.sendFile(path.join(__dirname, 'html', 'estoque.html'));
});

// Rota para buscar preço de custo pelo SKU
app.get('/preco-custo/:sku', async (req, res) => {
  const { sku } = req.params;

  try {
    const productCandidate = await buscarProdutoPorTermo(sku);
    if (!productCandidate || !productCandidate.id) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }
    const produtoId = productCandidate.id;

    // Buscar produto pelo ID
    const produtoResponse = await tinyGet(
      'https://api.tiny.com.br/api2/produto.obter.php',
      {
        token: TOKEN,
        id: produtoId,
        formato: 'json'
      }
    );

    const produto = produtoResponse.data.retorno.produto;

    let estoqueProduto = null;
    try {
      const estoqueResponse = await tinyGet(
        'https://api.tiny.com.br/api2/produto.obter.estoque.php',
        {
          token: TOKEN,
          id: produtoId,
          formato: 'json'
        }
      );

      const estoqueRaw = estoqueResponse?.data?.retorno?.produto?.saldo;
      estoqueProduto = parseEstoqueTiny(estoqueRaw);
    } catch (estoqueError) {
      console.warn('Falha ao obter estoque no Tiny:', estoqueError?.response?.data || estoqueError?.message);
    }

    // Log de mapeamentos (se existir) para inspeção
    try {
      const mapeamentos = produto.mapeamentos || [];
      if (Array.isArray(mapeamentos) && mapeamentos.length) {
        console.log(`Mapeamentos do produto ${produto.codigo || produto.id || ''}:`);
        mapeamentos.forEach((m, i) => {
          const mp = (m && m.mapeamento) ? m.mapeamento : m;
          const idEcom = mp?.idEcommerce ?? mp?.idEcommerce ?? mp?.idEcommerce;
          const skuMap = mp?.skuMapeamento || mp?.sku || '';
          const idMap = mp?.idMapeamento || mp?.idMap || '';
          const precoMap = mp?.preco ?? '';
          console.log(`  [${i}] idEcommerce=${idEcom} skuMapeamento=${skuMap} idMapeamento=${idMap} preco=${precoMap}`);
        });
      } else {
        console.log(`Nenhum mapeamento encontrado para produto ${produto.codigo || produto.id || ''}`);
      }
    } catch (logErr) {
      console.error('Erro ao logar mapeamentos:', logErr);
    }

    res.json({
      sku: produto.codigo,
      nome: produto.nome,
      estoque: estoqueProduto,
      preco_custo: produto.preco_custo,
      categoria: extrairCategoriaTiny(produto.categoria || produto.categorias || ''),
      peso_bruto: produto.peso_bruto ?? '',
      alturaEmbalagem: produto.alturaEmbalagem ?? '',
      larguraEmbalagem: produto.larguraEmbalagem ?? '',
      comprimentoEmbalagem: produto.comprimentoEmbalagem ?? '',
    });

  } catch (error) {
    console.error(error.response?.data || error.message);

    if (isTinyUnavailableError(error)) {
      return res.status(503).json({
        erro: 'API do Tiny indisponível no momento',
        codigo: 'TINY_UNAVAILABLE'
      });
    }

    res.status(500).json({ erro: 'Erro ao consultar Tiny' });
  }
});

// Rota de busca para typeahead: retorna lista de produtos (id, sku, nome)
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    // tentativa principal
    const tryPesquisa = async (term) => {
      const r = await tinyGet('https://api.tiny.com.br/api2/produtos.pesquisa.php', { token: TOKEN, pesquisa: term, formato: 'json' });
      return r.data.retorno.produtos || [];
    };

    let produtos = await tryPesquisa(q);

    // Tenta também buscar por SKUs compostos quando o termo for um prefixo simples (ex: '12570')
    // Isso ajuda a trazer variações como '12570-KIT2' quando o usuário digita '12570'.
    try {
      if (q && !q.includes('-')) {
        const extra = await tryPesquisa(`${q}-`);
        if (extra && extra.length) produtos = (produtos || []).concat(extra);
      }
    } catch (e) {
      // não fatal — seguimos com o que já temos
    }

    // normaliza, deduplica e ordena por relevância (prioriza SKU que começa com a query)
    const seen = new Map();
    const normalized = (produtos || []).map(p => {
      const produto = p.produto || {};
      const nome = produto.descricao || produto.nome || produto.titulo || produto.nome_produto || '';
      const sku = String(produto.codigo || '');
      const id = String(produto.id || sku || JSON.stringify(produto));
      return { raw: p, id, sku, nome };
    }).filter(it => {
      const key = it.id + '|' + (it.sku || '');
      if (seen.has(key)) return false;
      seen.set(key, true);
      return true;
    });

    const qLower = q.toLowerCase();
    const field = (req.query.field || '').toLowerCase();
    function scoreItem(it) {
      const sku = String(it.sku || '');
      const nome = String(it.nome || '').toLowerCase();
      let score = 0;
      if (sku.toLowerCase() === qLower) score += 1000;
      if (sku.toLowerCase().startsWith(qLower)) score += 800;
      if (sku.toLowerCase().includes(qLower)) score += 400;
      if (field !== 'sku' && nome.includes(qLower)) score += 200;
      if (/^\d+$/.test(q) && sku.startsWith(q)) score += 50;
      return score;
    }

    let candidates = normalized;
    if (field === 'sku') {
      candidates = normalized.filter(it => String(it.sku || '').toLowerCase().includes(qLower));
    }

    const scored = candidates.map(it => ({ id: it.id, sku: it.sku, nome: it.nome, score: scoreItem(it) }));
    scored.sort((a, b) => b.score - a.score);

    const items = scored.slice(0, 50).map(({ id, sku, nome }) => ({ id, sku, nome }));
    res.json(items);
  } catch (err) {
    console.error('search error', err.response?.data || err.message);

    if (isTinyUnavailableError(err)) {
      return res.status(503).json({
        erro: 'API do Tiny indisponível no momento',
        codigo: 'TINY_UNAVAILABLE'
      });
    }

    res.status(500).json([]);
  }
});

// Lista produtos com saldo reservado monitorando todos os pedidos em aberto com marcador.
app.get('/api/estoque-reservado', async (req, res) => {
  const situacaoConsulta = 'aberto';
  const marcadorConsulta = 'mercadoenvios coleta';

  try {
    const pedidosPorId = new Map();
    let paginasProcessadas = 0;
    let pagina = 1;
    const limitePaginas = 100;

    while (pagina <= limitePaginas) {
      const pesquisaResponse = await tinyGet('https://api.tiny.com.br/api2/pedidos.pesquisa.php', {
        token: TOKEN,
        situacao: situacaoConsulta,
        marcador: marcadorConsulta,
        pagina,
        formato: 'json'
      });

      const retornoPesquisa = pesquisaResponse?.data?.retorno || {};
      const statusPesquisa = String(retornoPesquisa.status || '').toLowerCase();

      if (statusPesquisa === 'erro') {
        const erroApi = retornoPesquisa?.erros?.[0]?.erro || 'Erro ao pesquisar pedidos no Tiny';
        const erroApiNorm = String(erroApi).toLowerCase();
        const mensagemSemRegistros = erroApiNorm.includes('consulta não retornou registros')
          || erroApiNorm.includes('consulta nao retornou registros');

        if (mensagemSemRegistros) {
          break;
        }

        return res.status(400).json({
          erro: erroApi,
          codigo: 'TINY_API_ERROR'
        });
      }

      const pedidosPagina = Array.isArray(retornoPesquisa.pedidos) ? retornoPesquisa.pedidos : [];
      if (pedidosPagina.length === 0) {
        break;
      }
      console.log(`Página ${pagina}: ${pedidosPagina.length} pedido(s) encontrados com marcador "${marcadorConsulta}" e situação "${situacaoConsulta}".`);

      paginasProcessadas += 1;

      for (const itemPedido of pedidosPagina) {
        const pedido = itemPedido?.pedido || {};
        const pedidoId = String(pedido.id || '').trim();
        if (!pedidoId) continue;
        if (!pedidosPorId.has(pedidoId)) {
          pedidosPorId.set(pedidoId, {
            id: pedidoId,
            numero: String(pedido.numero || '').trim(),
          });
        }
      }

      const totalPaginasRaw = Number(
        retornoPesquisa.numero_paginas
        ?? retornoPesquisa.total_paginas
        ?? retornoPesquisa.paginas
        ?? retornoPesquisa.qtd_paginas
        ?? 0
      );
      const totalPaginas = Number.isFinite(totalPaginasRaw) ? totalPaginasRaw : 0;

      if (totalPaginas > 0 && pagina >= totalPaginas) {
        break;
      }

      // Fallback quando a API nao informa total de paginas.
      if (!totalPaginas && pedidosPagina.length < 100) {
        break;
      }

      pagina += 1;
    }

    const reservasPorProduto = new Map();

    const pedidosList = Array.from(pedidosPorId.values());
    const detalhesPedidos = await mapWithConcurrency(pedidosList, 3, async (pedido) => {
      try {
        const pedidoResponse = await tinyGet('https://api.tiny.com.br/api2/pedido.obter.php', {
          token: TOKEN,
          id: pedido.id,
          formato: 'json'
        });

        const retornoPedido = pedidoResponse?.data?.retorno || {};
        const statusPedido = String(retornoPedido.status || '').toLowerCase();
        if (statusPedido === 'erro') return null;

        return retornoPedido.pedido || null;
      } catch (err) {
        console.warn(`Falha ao obter detalhes do pedido ${pedido.id}:`, err.response?.data || err.message);
        return null;
      }
    });

    for (const pedidoDetalhe of detalhesPedidos) {
      if (!pedidoDetalhe) continue;

      const itensPedido = Array.isArray(pedidoDetalhe.itens)
        ? pedidoDetalhe.itens
        : Array.isArray(pedidoDetalhe.itensPedido)
          ? pedidoDetalhe.itensPedido
          : [];

      console.log(`Processando pedido ${pedidoDetalhe.id || pedidoDetalhe.numero || ''} com ${itensPedido.length} item(s).`);

      for (const itemWrap of itensPedido) {
        const item = itemWrap?.item || itemWrap || {};
        console.log(`  Item: idProduto=${item.idProduto || item.id_produto || item.produto?.id || ''}, sku=${item.codigo || item.sku || item.codigoProduto || item.produto?.codigo || ''}, quantidade=${item.quantidade ?? item.qtd ?? item.qtde ?? item.quantidadeProduto ?? item.qtdProduto ?? item.produto?.quantidade ?? item.produto?.qtd ?? item.produto?.qtde ?? ''}`);
        const idProduto = String(
          item.idProduto
          || item.id_produto
          || item.produto?.id
          || item.idproduto
          || ''
        ).trim();
        const sku = String(
          item.codigo
          || item.sku
          || item.codigoProduto
          || item.produto?.codigo
          || ''
        ).trim();
        const nome = String(
          item.descricao
          || item.nome
          || item.produto?.nome
          || ''
        ).trim();
        const quantidadeReservada = parseEstoqueTiny(
          item.quantidade
          ?? item.qtd
          ?? item.qtde
          ?? item.quantidadeProduto
          ?? item.qtdProduto
          ?? item.produto?.quantidade
          ?? item.produto?.qtd
          ?? item.produto?.qtde
        ) || 0;

        if (quantidadeReservada <= 0) continue;

        const chaveProduto = String(idProduto || sku).trim();
        if (!chaveProduto) continue;

        if (!reservasPorProduto.has(chaveProduto)) {
          reservasPorProduto.set(chaveProduto, {
            id: idProduto,
            sku,
            nome,
            reserva: 0
          });
        }

        const reservaAtual = reservasPorProduto.get(chaveProduto);
        reservaAtual.id = reservaAtual.id || idProduto;
        reservaAtual.sku = reservaAtual.sku || sku;
        reservaAtual.nome = reservaAtual.nome || nome;
        reservaAtual.reserva += quantidadeReservada;
      }
    }

    const produtosComReserva = [];
    let produtosSemId = 0;

    const reservasList = Array.from(reservasPorProduto.values());
    const produtosProcessados = await mapWithConcurrency(reservasList, 3, async (item) => {
      let produtoId = String(item.id || '').trim();

      if (!produtoId && item.sku) {
        try {
          const candidato = await buscarProdutoPorTermo(item.sku);
          if (candidato?.id) {
            produtoId = String(candidato.id).trim();
          }
        } catch (err) {
          produtoId = '';
        }
      }

      if (!produtoId) {
        return { semId: true };
      }

      try {
        const estoqueResponse = await tinyGet('https://api.tiny.com.br/api2/produto.obter.estoque.php', {
          token: TOKEN,
          id: produtoId,
          formato: 'json'
        });

        const retornoEstoque = estoqueResponse?.data?.retorno || {};
        const statusEstoque = String(retornoEstoque.status || '').toLowerCase();
        if (statusEstoque === 'erro') {
          console.warn(`produto.obter.estoque retornou erro para produto ${produtoId}:`, retornoEstoque.erros || retornoEstoque);
          return null;
        }

        const produtoEstoque = retornoEstoque.produto || {};

        console.log(`Produto ${produtoId}: sku=${produtoEstoque.codigo || item.sku || ''}, nome=${produtoEstoque.nome || item.nome || ''}, saldo=${produtoEstoque.saldo ?? produtoEstoque.saldoDisponivel ?? produtoEstoque.estoqueDisponivel ?? ''}, reserva=${item.reserva || 0}`);

        const saldoFisico = parseEstoqueTiny(produtoEstoque.saldo) || 0;
        const estoqueReservado = Number(item.reserva || 0);
        const saldoDisponivelTiny = parseEstoqueTiny(
          produtoEstoque.saldoDisponivel
          ?? produtoEstoque.saldo_disponivel
          ?? produtoEstoque.estoqueDisponivel
          ?? produtoEstoque.estoque_disponivel
        );

        if (estoqueReservado <= 0) return null;

        const sku = String(produtoEstoque.codigo || item.sku || '').trim();
        const nome = String(produtoEstoque.nome || item.nome || '').trim();
        const estoqueDisponivel = saldoDisponivelTiny !== null
          ? saldoDisponivelTiny
          : (saldoFisico - estoqueReservado);

        return {
          id: produtoId,
          sku,
          nome,
          estoqueDisponivel,
          estoqueReservado,
          saldoFisico
        };
      } catch (err) {
        console.warn(`Falha ao consultar estoque do produto ${produtoId}:`, err.response?.data || err.message);
        return null;
      }
    });

    for (const produto of produtosProcessados) {
      if (!produto) continue;
      if (produto.semId) {
        produtosSemId += 1;
        continue;
      }
      produtosComReserva.push(produto);
    }

    const produtos = produtosComReserva.sort((a, b) => {
      const bySku = (a.sku || '').localeCompare(b.sku || '', 'pt-BR');
      if (bySku !== 0) return bySku;
      return (a.nome || '').localeCompare(b.nome || '', 'pt-BR');
    });

    return res.json({
      situacao: situacaoConsulta,
      marcador: marcadorConsulta,
      paginasProcessadas,
      pedidosProcessados: pedidosPorId.size,
      produtosMapeados: reservasPorProduto.size,
      produtosSemId,
      total: produtos.length,
      observacao: 'Consulta filtrada por pedidos em aberto com marcador mercadoenvios coleta.',
      produtos
    });
  } catch (error) {
    console.error(error.response?.data || error.message);

    if (isTinyUnavailableError(error)) {
      return res.status(503).json({
        erro: 'API do Tiny indisponivel no momento',
        codigo: 'TINY_UNAVAILABLE'
      });
    }

    return res.status(500).json({ erro: 'Erro ao consultar estoque reservado no Tiny' });
  }
});

// npx nodemon app.js
// fly deploy para deployar no fly.io (configurações no fly.toml)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta http://localhost:${PORT}/index.html`);
});
