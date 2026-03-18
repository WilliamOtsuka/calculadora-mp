require('dotenv').config();
const express = require('express');
const axios = require('axios');
const cors = require('cors');
const path = require('path');

const app = express();
app.use(cors());
app.use(express.json());

// Serve arquivos estáticos (index.html, css/ e js/)
app.use(express.static(path.join(__dirname)));

const TOKEN = process.env.TINY_TOKEN;

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

// Busca Produto via endpoint de pesquisa do Tiny e retorna o melhor candidato
async function buscarProdutoPorTermo(term) {
  const pesquisaResponse = await axios.get('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
    params: { token: TOKEN, pesquisa: term, formato: 'json' }
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
  const produtoResponse = await axios.get('https://api.tiny.com.br/api2/produto.obter.php', {
    params: {
      token: TOKEN,
      id,
      formato: 'json'
    }
  });

  return produtoResponse?.data?.retorno?.produto || null;
}

// Envia alteração de produto para o Tiny (recebe objeto `produto` já montado)
async function alterarProdutoTiny(produto) {
  const response = await axios.post(
    'https://api.tiny.com.br/api2/produto.alterar.php',
    null,
    {
      params: {
        token: TOKEN,
        formato: 'json',
        produto: JSON.stringify(produto)
      }
    }
  );

  console.log('Retorno Tiny:', JSON.stringify(response?.data, null, 2));
  return response.data;
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
    const produtoResponse = await axios.get(
      'https://api.tiny.com.br/api2/produto.obter.php',
      {
        params: {
          token: TOKEN,
          id: produtoId,
          formato: 'json'
        }
      }
    );

    const produto = produtoResponse.data.retorno.produto;

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
      preco_custo: produto.preco_custo,
      categoria: extrairCategoriaTiny(produto.categoria || produto.categorias || ''),
      peso_bruto: produto.peso_bruto ?? '',
      alturaEmbalagem: produto.alturaEmbalagem ?? '',
      larguraEmbalagem: produto.larguraEmbalagem ?? '',
      comprimentoEmbalagem: produto.comprimentoEmbalagem ?? '',
    });

  } catch (error) {
    console.error(error.response?.data || error.message);
    res.status(500).json({ erro: 'Erro ao consultar Tiny' });
  }
});

app.post('/preco-custo/atualizar', async (req, res) => {
  try {
    const sku = String(req.body?.sku || '').trim();
    const precoCusto = parseCustoTiny(req.body?.preco_custo);

    if (!TOKEN) {
      return res.status(500).json({ erro: 'TINY_TOKEN não configurado no servidor.' });
    }

    if (!sku) {
      return res.status(400).json({ erro: 'SKU obrigatório' });
    }

    if (!(precoCusto > 0)) {
      return res.status(400).json({ erro: 'Preço de custo inválido' });
    }

    const produto = await buscarProdutoPorSKU(sku);
    if (!produto?.id) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }

    if (produto.idProdutoPai && Number(produto.idProdutoPai) > 0) {
      console.warn('Produto é variação:', sku);
    }

    // Obter produto completo antes de montar o payload
    const produtoAtual = await obterProdutoPorId(produto.id);
    if (!produtoAtual) {
      return res.status(404).json({ erro: 'Não foi possível obter dados completos do produto no Tiny.' });
    }

    const produtoPayload = {
      id: produto.idProdutoPai,
      codigo: produtoAtual.codigo,
      nome: produtoAtual.nome,
      tipo: produtoAtual.tipo,
      situacao: produtoAtual.situacao,
      unidade: produtoAtual.unidade,
      preco_custo: Number(precoCusto)
    };

    const tinyResponse = await alterarProdutoTiny(produtoPayload);

    const retorno = tinyResponse?.retorno;

    if (String(retorno?.status || '').toUpperCase() !== 'OK') {
      return res.status(400).json({
        erro: 'Erro no Tiny',
        detalhe: retorno
      });
    }

    return res.json({
      ok: true,
      sku,
      preco_custo: Number(precoCusto).toFixed(2),
      mensagem: 'Atualizado com sucesso no Tiny'
    });
  } catch (err) {
    console.error(err?.response?.data || err.message);

    return res.status(500).json({
      erro: 'Erro ao atualizar no Tiny'
    });
  }
});


// Rota de busca para typeahead: retorna lista de produtos (id, sku, nome)
app.get('/search', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q) return res.json([]);
  try {
    // tentativa principal
    const tryPesquisa = async (term) => {
      const r = await axios.get('https://api.tiny.com.br/api2/produtos.pesquisa.php', { params: { token: TOKEN, pesquisa: term, formato: 'json' } });
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
    res.status(500).json([]);
  }
});

// npx nodemon app.js
// fly deploy para deployar no fly.io (configurações no fly.toml)

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta http://localhost:${PORT}`);
});
