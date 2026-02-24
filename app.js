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

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// Rota para buscar preço de custo pelo SKU
app.get('/preco-custo/:sku', async (req, res) => {
  const { sku } = req.params;

  try {
    // 1️⃣ Buscar produto pelo termo (pode ser SKU, ou parte do nome)
    const pesquisaResponse = await axios.get('https://api.tiny.com.br/api2/produtos.pesquisa.php', {
      params: { token: TOKEN, pesquisa: sku, formato: 'json' }
    });

    const produtos = pesquisaResponse.data.retorno.produtos;

    if (!produtos || produtos.length === 0) {
      return res.status(404).json({ erro: 'Produto não encontrado' });
    }

    // Normaliza resultados e escolhe o melhor candidato
    const term = String(sku || '').toLowerCase();
    const mapped = (produtos || []).map(p => {
      const produto = p.produto || {};
      return {
        raw: p,
        id: produto.id,
        codigo: String(produto.codigo || '').toLowerCase(),
        nome: String(produto.descricao || produto.nome || produto.titulo || '').toLowerCase()
      };
    });

    function scoreItem(it) {
      if (!it) return 0;
      const codigo = it.codigo || '';
      const nome = it.nome || '';
      let score = 0;
      if (codigo === term) score += 1000; // SKU exato
      if (codigo && term && codigo.startsWith(term)) score += 800; // SKU começa com term
      if (codigo && term && codigo.includes(term)) score += 600; // SKU contém term
      if (nome && term && nome.includes(term)) score += 400; // nome contém term
      return score;
    }

    let best = mapped[0];
    let bestScore = scoreItem(best);
    for (const m of mapped) {
      const sc = scoreItem(m);
      if (sc > bestScore) { best = m; bestScore = sc; }
    }

    const produtoId = (best && best.id) ? best.id : (mapped[0] && mapped[0].id);

    // 2️⃣ Buscar produto pelo ID
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
    });

  } catch (error) {
    console.error(error.response?.data || error.message);
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
      // only use name matches when field is not 'sku'
      if (field !== 'sku' && nome.includes(qLower)) score += 200;
      // small boost for numeric queries when sku starts with numeric prefix
      if (/^\d+$/.test(q) && sku.startsWith(q)) score += 50;
      return score;
    }
    // If field=sku, filter out items that have no sku match at all (avoid name-only matches)
    let candidates = normalized;
    if (field === 'sku') {
      candidates = normalized.filter(it => String(it.sku || '').toLowerCase().includes(qLower));
    }

    const scored = candidates.map(it => ({ id: it.id, sku: it.sku, nome: it.nome, score: scoreItem(it) }));
    scored.sort((a, b) => b.score - a.score);

    const items = scored.slice(0, 50).map(({ id, sku, nome }) => ({ id, sku, nome }));
    // Debug log (opcional): console.log(`search q=${q} results`, items.map(i=>i.sku));
    res.json(items);
  } catch (err) {
    console.error('search error', err.response?.data || err.message);
    res.status(500).json([]);
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor rodando na porta http://localhost:${PORT}`);
});
