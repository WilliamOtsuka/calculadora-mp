// Utilidades de formato e parsing (suporta vírgula e ponto)
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Shopee bracket table (fonte única da verdade para faixas)
const SHOPEE_BRACKETS = [
  { min: 0, max: 80, com: 0.20, tf: 4 },            // até 79,99 -> 20% + R$4
  { min: 80, max: 100, com: 0.14, tf: 16 },         // 80..99,99 -> 14% + R$16
  { min: 100, max: 200, com: 0.14, tf: 20 },        // 100..199,99 -> 14% + R$20
  { min: 200, max: Infinity, com: 0.14, tf: 26 }    // 200+ -> 14% + R$26
];

function obterFaixaFromBrackets(pv) {
  for (const b of SHOPEE_BRACKETS) {
    const inRange = (b.min === undefined || pv >= b.min) && (b.max === undefined || pv < b.max);
    if (inRange) return { comissao_base: b.com, taxa_fixa: b.tf };
  }
  // fallback padrão
  const last = SHOPEE_BRACKETS[SHOPEE_BRACKETS.length - 1];
  return { comissao_base: last.com, taxa_fixa: last.tf };
}

function parseDecimal(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v !== 'string') v = String(v);
  // Remove símbolo de moeda e espaços
  v = v.replace(/R\$\s?/gi, '');
  v = v.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

// Sanitização de entradas numéricas (permite apenas dígitos e separador decimal)
function sanitizeNumberString(str, maxDecimals = 2) {
  if (str == null) return '';
  let v = String(str);
  // mantém apenas dígitos e , .
  v = v.replace(/[^0-9.,]/g, '');
  // Se tiver vírgula, remove todos os pontos (pontos tratados como milhar)
  if (v.includes(',')) {
    v = v.replace(/\./g, '');
  } else if (v.includes('.')) {
    // Não tem vírgula e tem ponto -> considera primeiro ponto como decimal
    // troca primeiro ponto por vírgula e remove os demais
    let first = true;
    v = v.replace(/\./g, m => {
      if (first) { first = false; return ','; }
      return '';
    });
  }
  // garante no máximo uma vírgula
  let seenComma = false;
  let out = '';
  for (const ch of v) {
    if (ch === ',') {
      if (seenComma) continue;
      seenComma = true;
      out += ch;
    } else {
      out += ch;
    }
  }
  // limita casas decimais
  if (seenComma && maxDecimals >= 0) {
    const [intp, fracp = ''] = out.split(',');
    out = intp + ',' + fracp.slice(0, maxDecimals);
  }
  return out;
}

const marketplaces = ['ml', 'shopee', 'magalu'];
const fields = ['custo', 'embalagem', 'taxa_fixa', 'margem_lucro', 'comissao', 'subsidio', 'das', 'descontos', 'outras', 'spike_day'];
const pctFields = ['margem_lucro', 'comissao', 'subsidio', 'das', 'descontos', 'outras', 'spike_day'];
// Campos específicos da ML (sem tipo_anuncio, pois calculamos ambos os tipos)
const mlExtraFields = ['categoria', 'custos_adic', 'impostos'];

function byId(id) { return document.getElementById(id); }
function setText(id, t) { const el = byId(id); if (el) el.textContent = t; }

function saveState(prefix) {
  const key = `calc_${prefix}_v1`;
  const s = {};
  for (const f of fields) { const el = byId(`${f}_${prefix}`); if (el) s[f] = el.value; }
  if (prefix === 'ml') {
    for (const f of mlExtraFields) { const el = byId(`${f}_${prefix}`); if (el) s[f] = el.value; }
  }
  // shopee-specific checkboxes removed
  localStorage.setItem(key, JSON.stringify(s));
}
function loadState(prefix) {
  try {
    const key = `calc_${prefix}_v1`;
    const raw = localStorage.getItem(key); if (!raw) return;
    const s = JSON.parse(raw);
    for (const f of fields) if (s[f] !== undefined) { const el = byId(`${f}_${prefix}`); if (el) el.value = s[f]; }
    if (prefix === 'ml') {
      for (const f of mlExtraFields) if (s[f] !== undefined) { const el = byId(`${f}_${prefix}`); if (el) el.value = s[f]; }
    }
    // shopee-specific persisted flags removed
  } catch { }
}

function recalc(prefix) {
  saveState(prefix);
  const getPct = name => parseDecimal((byId(`${name}_${prefix}`) || {}).value) / 100;
  const getMoney = name => parseDecimal((byId(`${name}_${prefix}`) || {}).value);

  const custo = getMoney('custo');
  const taxaFixa = getMoney('taxa_fixa');
  const ml = getPct('margem_lucro');

  // Função auxiliar para calcular preço Shopee conforme tabela fornecida
  function calcular_preco_shopee(
    custo,
    margem_desejada,
    pSub = 0,
    pDas = 0,
    pDesc = 0,
    pOutras = 0,
    pSpike = 0
  ) {

    const obterFaixa = obterFaixaFromBrackets;

    let pv = custo; // chute inicial coerente
    let faixaAtual = obterFaixa(pv);

    for (let i = 0; i < 10; i++) {

      const totalPct =
        faixaAtual.comissao_base +
        margem_desejada +
        pSub +
        pDas +
        pDesc +
        pOutras +
        pSpike;

      const denominador = 1 - totalPct;

      if (denominador <= 0) {
        return {
          pv: 0,
          comissao_efetiva: 0,
          taxa_fixa: 0,
          comissao_base: 0
        };
      }

      const novoPv = (custo + faixaAtual.taxa_fixa) / denominador;

      const novaFaixa = obterFaixa(novoPv);

      // se a faixa não mudou, estabilizou
      if (
        novaFaixa.comissao_base === faixaAtual.comissao_base &&
        novaFaixa.taxa_fixa === faixaAtual.taxa_fixa
      ) {
        pv = novoPv;
        break;
      }

      faixaAtual = novaFaixa;
      pv = novoPv;
    }

    return {
      pv,
      comissao_efetiva: faixaAtual.comissao_base,
      taxa_fixa: faixaAtual.taxa_fixa,
      comissao_base: faixaAtual.comissao_base
    };
  }

  // Regras ML: calcular para Clássico e Premium simultaneamente
  if (prefix === 'ml') {
    const categoria = (byId('categoria_ml') || {}).value || 'padrao';
    const impostosPct = parseDecimal((byId('impostos_ml') || {}).value) / 100;
    const custosAdic = parseDecimal((byId('custos_adic_ml') || {}).value);
    const msg = byId(`msg_${prefix}`);
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }

    function computeAndFill(tipo) {
      // Decide pCom e tarifa fixa pela regra, considerando categoria e valor base
      let pCom, tarifaFixa;
      const base = custo * (1 + ml);
      if (categoria === 'isenta') { pCom = 0; tarifaFixa = 0; }
      else if (base === 0) { pCom = 0; tarifaFixa = (tipo === 'premium') ? 7 : 6; }
      else if (base < 12.5) { pCom = 0.50; tarifaFixa = 0; }
      else if (base <= 120) {
        pCom = 0; tarifaFixa = (tipo === 'premium') ? 7 : 6;
      } else {
        tarifaFixa = 0; pCom = (tipo === 'premium') ? 0.16 : 0.11;
      }
      const pImp = impostosPct;
      const tt = pCom + pImp;
      const totalEl = byId(`total_taxas_ml_${tipo}`);
      if (totalEl) totalEl.value = (tt * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      const etapa1 = custo * (1 + ml);
      const etapa2 = etapa1 + tarifaFixa + custosAdic;
      const denom = 1 - tt;
      if (byId(`comissao_pct_ml_${tipo}`)) byId(`comissao_pct_ml_${tipo}`).value = (pCom * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      if (byId(`tarifa_fixa_ml_${tipo}`)) byId(`tarifa_fixa_ml_${tipo}`).value = fmtBRL.format(tarifaFixa);
      if (denom <= 0) {
        const pvEl = byId(`pv_ml_${tipo}`); if (pvEl) pvEl.textContent = '—';
        const liqEl = byId(`liquido_ml_${tipo}`); if (liqEl) liqEl.textContent = '—';
        return { pv: 0, vCom: 0, vImp: 0, tarifaFixa, custosAdic, liquido: 0, lucro: 0, margem: 0 };
      }
      const pv = etapa2 / denom;
      const vCom = pv * pCom;
      const vImp = pv * pImp;
      const liquido = pv - vCom - vImp - tarifaFixa - custosAdic;
      const lucro = liquido - custo;
      const margem = pv > 0 ? (lucro / pv) : 0;
      const pvEl = byId(`pv_ml_${tipo}`); if (pvEl) pvEl.textContent = fmtBRL.format(pv);
      const liqEl = byId(`liquido_ml_${tipo}`); if (liqEl) liqEl.textContent = fmtBRL.format(liquido);
      return { pv, vCom, vImp, tarifaFixa, custosAdic, liquido, lucro, margem, tt };
    }

    const classic = computeAndFill('classico');
    const premium = computeAndFill('premium');

    if (classic) {
      setText('det_comissao_ml', fmtBRL.format(classic.vCom || 0));
      setText('det_tarifa_fixa_ml', fmtBRL.format(classic.tarifaFixa || 0));
      setText('det_impostos_ml', fmtBRL.format(classic.vImp || 0));
      setText('det_custos_adic_ml', fmtBRL.format(classic.custosAdic || 0));
      setText('det_total_taxas_ml', fmtBRL.format(((classic.pv || 0) * ((classic.tt) || 0)) || 0));
      setText('det_liquido_ml', fmtBRL.format(classic.liquido || 0));
      setText('det_lucro_ml', fmtBRL.format(classic.lucro || 0));
      setText('det_margem_efetiva_ml', (((classic.margem || 0) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%'));
    }
    return; // fim fluxo ML
  }

  // Shopee específico: usa tabela de faixas e inclui DAS/Descontos/Outras na soma percentual
  if (prefix === 'shopee') {
    const msg = byId(`msg_${prefix}`);
    if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }

    const pDas = getPct('das');
    const pDesc = getPct('descontos');
    const pOutras = getPct('outras');

    // passar DAS/descontos/outras para convergir a faixa correta
    const pSpike = getPct('spike_day');
    const res = calcular_preco_shopee(custo, ml, 0, pDas, pDesc, pOutras, pSpike);
    let pv = res.pv || 0;
    let comissao_base = res.comissao_base || 0;
    let taxa_fixa_calc = res.taxa_fixa || 0;

    // Se não convergiu, testar manualmente cada faixa e escolher a que produz PV válido
    if (!pv || pv <= 0) {
      for (const b of SHOPEE_BRACKETS) {
        const com = b.com;
        const tf = b.tf;
        const totalPct = com + pDas + pDesc + pOutras + pSpike + ml;
        const denomTry = 1 - totalPct;
        if (denomTry <= 0) continue;
        const pvTry = (custo + tf) / denomTry;
        const inRange = (b.min === undefined || pvTry >= b.min) && (b.max === undefined || pvTry < b.max);
        if (inRange) {
          pv = pvTry;
          comissao_base = com;
          taxa_fixa_calc = tf;
          break;
        }
      }
    }

    if (byId(`pv_shopee`)) byId(`pv_shopee`).textContent = pv > 0 ? fmtBRL.format(pv) : '—';

    // comissão definida pela tabela (não editável)
    const comEl = byId('comissao_shopee'); if (comEl) comEl.value = (comissao_base * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    // Mostrar taxa fixa calculada no input correspondente
    const taxaInputEl = byId('taxa_fixa_shopee'); if (taxaInputEl) taxaInputEl.value = fmtBRL.format(taxa_fixa_calc);

    const vCom = pv * comissao_base;
    const vDas = pv * pDas;
    const vDesc = pv * pDesc;
    const vSpike = pv * pSpike;
    const vTotTaxas = vCom + vDas + vDesc + vSpike + taxa_fixa_calc;
    const lucro = pv - custo - vTotTaxas;
    const margemEfetiva = pv > 0 ? (lucro / pv) : 0;

    const totalEl = byId(`total_taxas_shopee`);
    if (totalEl) totalEl.value = ((comissao_base + pDas + pDesc + pSpike) * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

    setText(`det_comissao_shopee`, fmtBRL.format(vCom));
    setText(`det_das_shopee`, fmtBRL.format(vDas));
    setText(`det_descontos_shopee`, fmtBRL.format(vDesc));
    setText(`det_total_taxas_shopee`, fmtBRL.format(vTotTaxas));
    setText(`det_taxa_fixa_shopee`, fmtBRL.format(taxa_fixa_calc));
    setText(`det_lucro_shopee`, fmtBRL.format(lucro));
    setText(`det_margem_efetiva_shopee`, (margemEfetiva * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');

    // Simulação: calcule margem (R$ e %) se aplicássemos a faixa anterior e a próxima
    function calcMargemForBracket(pvVal, comPct, taxaF) {
      const vComSim = pvVal * comPct;
      const vDasSim = pvVal * pDas;
      const vDescSim = pvVal * pDesc;
      const totalSim = vComSim + vDasSim + vDescSim + taxaF;
      const lucroSim = pvVal - custo - totalSim;
      const margemSim = pvVal > 0 ? (lucroSim / pvVal) : 0;
      return { lucroSim, margemSim };
    }

    // encontra índice da faixa atual
    let faixaIdx = SHOPEE_BRACKETS.findIndex(b => (b.min === undefined || pv >= b.min) && (b.max === undefined || pv < b.max));
    if (faixaIdx === -1) faixaIdx = SHOPEE_BRACKETS.length - 1;

    // guarda dados para modal de simulação
    window.lastShopeeSim = { pv, faixaIdx, custo, pDas, pDesc, lower: (faixaIdx - 1 >= 0 ? SHOPEE_BRACKETS[faixaIdx - 1] : null), higher: (faixaIdx + 1 < SHOPEE_BRACKETS.length ? SHOPEE_BRACKETS[faixaIdx + 1] : null) };
    return;
  }

  // Fluxo padrão (Magalu e outros): mantém cálculo anterior
  const pCom = getPct('comissao');
  const pSub = getPct('subsidio');
  const pDas = getPct('das');
  const pDesc = getPct('descontos');
  const pOutras = getPct('outras');
  const tt = pCom + pSub + pDas + pDesc + pOutras;
  const totalEl = byId(`total_taxas_${prefix}`);
  if (totalEl) totalEl.value = (tt * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const msg = byId(`msg_${prefix}`);
  if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }

  const etapa1 = custo * (1 + ml);
  const etapa2 = etapa1 + taxaFixa;
  const denom = 1 - tt;

  const etapasEl = byId(`etapas_${prefix}`); // opcional
  if (etapasEl) etapasEl.innerHTML = `1) ${fmtBRL.format(etapa1)} | 2) ${fmtBRL.format(etapa2)} | 3) dividir por ${fmtPct.format(denom)}`;

  if (denom <= 0) {
    const pvEl = byId(`pv_${prefix}`); if (pvEl) pvEl.textContent = '—';
    // Zera detalhamento
    ['det_comissao', 'det_subsidio', 'det_das', 'det_descontos', 'det_outras', 'det_total_taxas', 'det_taxa_fixa', 'det_lucro', 'det_margem_efetiva']
      .forEach(id => setText(`${id}_${prefix}`, id.endsWith('margem_efetiva') ? '0,00%' : fmtBRL.format(0)));
    if (msg) { msg.classList.remove('hidden'); msg.textContent = 'O total de taxas é maior ou igual a 100%.'; }
    return;
  }

  const pv = etapa2 / denom;
  const vCom = pv * pCom;
  const vSub = pv * pSub;
  const vDas = pv * pDas;
  const vDes = pv * pDesc;
  const vOut = pv * pOutras;
  const vTotTaxas = pv * tt;

  const lucro = pv - custo - vTotTaxas - taxaFixa;
  const margemEfetiva = pv > 0 ? (lucro / pv) : 0;

  const pvEl = byId(`pv_${prefix}`); if (pvEl) pvEl.textContent = fmtBRL.format(pv);
  setText(`det_comissao_${prefix}`, fmtBRL.format(vCom));
  setText(`det_subsidio_${prefix}`, fmtBRL.format(vSub));
  setText(`det_das_${prefix}`, fmtBRL.format(vDas));
  setText(`det_descontos_${prefix}`, fmtBRL.format(vDes));
  setText(`det_outras_${prefix}`, fmtBRL.format(vOut));
  setText(`det_total_taxas_${prefix}`, fmtBRL.format(vTotTaxas));
  setText(`det_taxa_fixa_${prefix}`, fmtBRL.format(taxaFixa));
  setText(`det_lucro_${prefix}`, fmtBRL.format(lucro));
  setText(`det_margem_efetiva_${prefix}`, (margemEfetiva * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
}

function attach() {
  // Vincula campos compartilhados (copiam seus valores para cada formulário e recalculam)
  const sharedFields = ['custo', 'embalagem', 'margem_lucro', 'das', 'descontos'];
  for (const f of sharedFields) {
    const sharedEl = byId(`shared_${f}`);
    if (!sharedEl) continue;
    // sanitização em tempo real
    sharedEl.addEventListener('input', () => {
      const isPct = pctFields.includes(f);
      const clean = sanitizeNumberString(sharedEl.value, 2);
      if (sharedEl.value !== clean) sharedEl.value = clean;
      // copia para todos os prefixes
      for (const prefix of marketplaces) {
        const tgt = byId(`${f}_${prefix}`);
        if (tgt) tgt.value = sharedEl.value;
      }
      // recalcula todos
      for (const prefix of marketplaces) recalc(prefix);
    });
    sharedEl.addEventListener('blur', () => {
      const val = parseDecimal(sharedEl.value);
      if (pctFields.includes(f)) {
        sharedEl.value = val.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
      } else {
        sharedEl.value = fmtBRL.format(val);
      }
      for (const prefix of marketplaces) {
        const tgt = byId(`${f}_${prefix}`);
        if (tgt) {
          tgt.value = sharedEl.value;
        }
      }
      for (const prefix of marketplaces) recalc(prefix);
    });
  }

  // SKU / Nome lookup: busca preço de custo via rota do servidor e preenche `shared_custo`
  const skuInput = byId('tiny_sku');
  const nomeInput = byId('tiny_nome');
  const skuBtn = byId('buscar_sku_btn');
  const skuMsg = byId('sku_msg');

  async function buscarPorSku(skuArg) {
    // skuArg optional: if provided, use it; otherwise take from skuInput
    const currentSku = (skuArg || (skuInput && skuInput.value.trim()))?.trim();
    if (!currentSku) {
      // If no SKU but nomeInput has value, try search endpoint to resolve
      const nomeQ = nomeInput && nomeInput.value.trim();
      if (!nomeQ) {
        if (skuMsg) skuMsg.textContent = 'Informe SKU ou nome.';
        return;
      }
      try {
        if (skuBtn) skuBtn.disabled = true;
        if (skuMsg) skuMsg.textContent = 'Pesquisando por nome...';
        const sr = await fetch(`/search?q=${encodeURIComponent(nomeQ)}`);
        if (!sr.ok) { if (skuMsg) skuMsg.textContent = 'Erro na pesquisa por nome.'; return; }
        const list = await sr.json();
        if (!list || list.length === 0) { if (skuMsg) skuMsg.textContent = 'Nome não encontrado.'; return; }
        const first = list[0];
        if (skuInput) skuInput.value = first.sku || '';
        if (nomeInput) nomeInput.value = first.nome || '';
        return buscarPorSku(first.sku);
      } catch (e) {
        if (skuMsg) skuMsg.textContent = 'Erro de rede.';
        return;
      } finally {
        if (skuBtn) skuBtn.disabled = false;
      }
    }
    if (skuBtn) skuBtn.disabled = true;
    if (skuMsg) { skuMsg.textContent = 'Pesquisando...'; }
    try {
      const res = await fetch(`/preco-custo/${encodeURIComponent(currentSku)}`);
      if (!res.ok) {
        if (res.status === 404) {
          if (skuMsg) skuMsg.textContent = 'SKU não encontrado.';
        } else {
          if (skuMsg) {
            skuMsg.textContent = 'Erro na consulta.';
            console.error('Erro na consulta SKU:', res.status, await res.text());
          }
        }
        return;
      }
      const data = await res.json();
      console.log(data); // log completo para inspeção
      const precoRaw = data.preco_custo;
      const nomeProduto = data.nome || '';
      // Se o servidor retornou um SKU diferente do termo pesquisado, atualiza o input
      if (skuInput && data.sku) skuInput.value = String(data.sku);
      // Preenche campo compartilhado e propaga para forms
      const sharedC = byId('shared_custo');
      
      if (sharedC) {
        sharedC.value = fmtBRL.format(precoRaw);
        // copia para cada marketplace
        for (const prefix of marketplaces) {
          const tgt = byId(`custo_${prefix}`);
          if (tgt) tgt.value = sharedC.value;
          recalc(prefix);
        }
      }
      if (nomeInput && nomeProduto) nomeInput.value = nomeProduto;
      if (skuMsg) skuMsg.textContent = `Preço preenchido. Nome: ${nomeProduto || '—'}`;
    } catch (err) {
      if (skuMsg) skuMsg.textContent = 'Erro de rede.';
    } finally {
      if (skuBtn) skuBtn.disabled = false;
    }
  }
  if (skuBtn) skuBtn.addEventListener('click', () => buscarPorSku());
  if (skuInput) skuInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarPorSku(); } });
  if (nomeInput) nomeInput.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); buscarPorSku(); } });

  // Typeahead: busca sugestões enquanto o usuário digita (SKU ou nome)
  let suggestBox = null;
  let suggestions = [];
  let selIdx = -1;
  let focusedInput = skuInput || nomeInput || null;

  function createSuggestBox() {
    if (suggestBox) return suggestBox;
    suggestBox = document.createElement('div');
    suggestBox.style.position = 'absolute';
    suggestBox.style.zIndex = 9999;
    // visual styles live in CSS class
    suggestBox.className = 'sku-suggestions';
    document.body.appendChild(suggestBox);
    return suggestBox;
  }

  function positionSuggestBox() {
    if (!focusedInput || !suggestBox) return;
    const r = focusedInput.getBoundingClientRect();
    suggestBox.style.left = (window.scrollX + r.left) + 'px';
    suggestBox.style.top = (window.scrollY + r.bottom + 6) + 'px';
    suggestBox.style.width = r.width + 'px';
  }

  function clearSuggestions() {
    suggestions = [];
    selIdx = -1;
    if (suggestBox) {
      suggestBox.innerHTML = '';
      if (suggestBox.parentNode) suggestBox.parentNode.removeChild(suggestBox);
      suggestBox = null;
    }
  }

  function renderSuggestions(items) {
    createSuggestBox();
    positionSuggestBox();
    suggestions = items || [];
    suggestBox.innerHTML = '';
    if (!suggestions.length) return;
    suggestions.forEach((it, i) => {
      const el = document.createElement('div');
      el.style.padding = '6px 8px';
      el.style.cursor = 'pointer';
      el.dataset.idx = String(i);
      el.innerHTML = `<strong>${it.sku || ''}</strong> <span class="muted">${it.nome || ''}</span>`;
      el.addEventListener('click', () => {
        // preenche ambos campos quando disponível
        if (skuInput) skuInput.value = it.sku || '';
        if (nomeInput) nomeInput.value = it.nome || '';
        clearSuggestions();
        buscarPorSku(it.sku);
      });
      suggestBox.appendChild(el);
    });
  }

  function highlight(index) {
    if (!suggestBox) return;
    const children = Array.from(suggestBox.children);
    children.forEach((c, i) => c.style.background = (i === index) ? '#efefef' : '#fff');
    selIdx = index;
  }

  function debounce(fn, wait) {
    let t = null; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), wait); };
  }

  const doSuggest = debounce(async () => {
    const src = focusedInput || skuInput || nomeInput;
    if (!src) return;
    const q = src.value.trim();
    if (q.length < 2) { clearSuggestions(); return; }
    try {
      // inform server whether user is typing in SKU or Nome to improve results
      const field = (focusedInput === skuInput) ? 'sku' : 'nome';
      const res = await fetch(`/search?q=${encodeURIComponent(q)}&field=${encodeURIComponent(field)}`);
      if (!res.ok) { clearSuggestions(); return; }
      const items = await res.json();
      renderSuggestions(items.slice(0, 10));
    } catch (e) {
      clearSuggestions();
    }
  }, 250);

  if (skuInput || nomeInput) {
    const inputs = [skuInput, nomeInput].filter(Boolean);
    inputs.forEach(inp => {
      inp.addEventListener('focus', () => { focusedInput = inp; });
      inp.addEventListener('input', () => { focusedInput = inp; doSuggest(); });
      inp.addEventListener('keydown', (e) => {
        if (!suggestBox) return;
        if (e.key === 'ArrowDown') { e.preventDefault(); highlight(Math.min(suggestions.length - 1, selIdx + 1)); }
        else if (e.key === 'ArrowUp') { e.preventDefault(); highlight(Math.max(0, selIdx - 1)); }
        else if (e.key === 'Enter') {
          if (selIdx >= 0 && suggestions[selIdx]) {
            e.preventDefault();
            const it = suggestions[selIdx];
            if (skuInput) skuInput.value = it.sku || '';
            if (nomeInput) nomeInput.value = it.nome || '';
            clearSuggestions();
            buscarPorSku(it.sku);
          }
        } else if (e.key === 'Escape') { clearSuggestions(); }
      });
    });
    window.addEventListener('resize', positionSuggestBox);
    document.addEventListener('click', (ev) => { if (ev.target !== skuInput && ev.target !== nomeInput && ev.target.closest('.sku-suggestions') == null) clearSuggestions(); });
  }

  // Botão único de limpar que zera compartilhados e cada formulário
  const resetAll = byId('resetBtn_all');
  if (resetAll) resetAll.addEventListener('click', () => {
    // limpa campos compartilhados
    for (const f of sharedFields) {
      const s = byId(`shared_${f}`);
      if (s) s.value = '';
    }
    // limpa campos individuais e vistas
    for (const prefix of marketplaces) {
      for (const f of fields.concat(prefix === 'ml' ? mlExtraFields : [])) {
        const el = byId(`${f}_${prefix}`);
        if (el) el.value = '';
      }
      if (prefix === 'ml') {
        ['classico', 'premium'].forEach(tipo => {
          const pvEl = byId(`pv_ml_${tipo}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
          const liqEl = byId(`liquido_ml_${tipo}`); if (liqEl) liqEl.textContent = 'R$ 0,00';
          const ttEl = byId(`total_taxas_ml_${tipo}`); if (ttEl) ttEl.value = '';
          const comEl = byId(`comissao_pct_ml_${tipo}`); if (comEl) comEl.value = '';
          const tfEl = byId(`tarifa_fixa_ml_${tipo}`); if (tfEl) tfEl.value = '';
        });
      } else {
        const pvEl = byId(`pv_${prefix}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
        const ttEl = byId(`total_taxas_${prefix}`); if (ttEl) ttEl.value = '';
        const etap = byId(`etapas_${prefix}`); if (etap) etap.textContent = '';
      }
      const msg = byId(`msg_${prefix}`); if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }
    }
    // recalcula para garantir consistência
    for (const prefix of marketplaces) recalc(prefix);
  });

  for (const prefix of marketplaces) {
    loadState(prefix);
    for (const f of fields.concat(prefix === 'ml' ? mlExtraFields : [])) {
      const el = byId(`${f}_${prefix}`);
      if (!el) continue;
      // Bloqueia caracteres não numéricos durante a digitação (para inputs de texto)
      if (el.tagName !== 'SELECT') {
        el.addEventListener('keypress', (e) => {
          if (e.key && e.key.length === 1 && !/[0-9.,]/.test(e.key)) {
            e.preventDefault();
          }
        });
      }
      // Sanitiza em tempo real e recalcula
      el.addEventListener('input', () => {
        if (el.tagName !== 'SELECT') {
          const isPct = pctFields.includes(f) || (prefix === 'ml' && f === 'impostos');
          const isMoney = (f === 'custo' || f === 'taxa_fixa' || (prefix === 'ml' && f === 'custos_adic'));
          if (isPct || isMoney) {
            const clean = sanitizeNumberString(el.value, 2);
            if (el.value !== clean) el.value = clean;
          }
        }
        recalc(prefix);
      });
      el.addEventListener('blur', () => {
        const val = parseDecimal(el.value);
        const isPct = pctFields.includes(f) || (prefix === 'ml' && f === 'impostos');
        const isMoney = (f === 'custo' || f === 'taxa_fixa' || (prefix === 'ml' && f === 'custos_adic'));
        if (isPct) {
          el.value = val.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
        } else if (isMoney) {
          el.value = fmtBRL.format(val);
        } else {
          el.value = val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
      });
    }

    const resetBtn = byId(`resetBtn_${prefix}`);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      for (const f of fields.concat(prefix === 'ml' ? mlExtraFields : [])) { const el = byId(`${f}_${prefix}`); if (el) el.value = ''; }
      if (prefix === 'ml') {
        ['classico', 'premium'].forEach(tipo => {
          const pvEl = byId(`pv_ml_${tipo}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
          const liqEl = byId(`liquido_ml_${tipo}`); if (liqEl) liqEl.textContent = 'R$ 0,00';
          const ttEl = byId(`total_taxas_ml_${tipo}`); if (ttEl) ttEl.value = '';
          const comEl = byId(`comissao_pct_ml_${tipo}`); if (comEl) comEl.value = '';
          const tfEl = byId(`tarifa_fixa_ml_${tipo}`); if (tfEl) tfEl.value = '';
        });
      } else {
        const pvEl = byId(`pv_${prefix}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
        const ttEl = byId(`total_taxas_${prefix}`); if (ttEl) ttEl.value = '';
        const etap = byId(`etapas_${prefix}`); if (etap) etap.textContent = '';
      }
      const msg = byId(`msg_${prefix}`); if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }
      recalc(prefix);
    });

    const copyBtn = byId(`copyBtn_${prefix}`);
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      let texto = '';
      if (prefix === 'ml') {
        const pvC = (byId('pv_ml_classico') || {}).textContent || '';
        const ttC = (byId('total_taxas_ml_classico') || {}).value || '';
        const liqC = (byId('liquido_ml_classico') || {}).textContent || '';
        const pvP = (byId('pv_ml_premium') || {}).textContent || '';
        const ttP = (byId('total_taxas_ml_premium') || {}).value || '';
        const liqP = (byId('liquido_ml_premium') || {}).textContent || '';
        texto = `Mercado Livre\n- Clássico: PV ${pvC} | Taxas ${ttC}% | Líquido ${liqC}\n- Premium: PV ${pvP} | Taxas ${ttP}% | Líquido ${liqP}`;
      } else {
        const pv = (byId(`pv_${prefix}`) || {}).textContent || '';
        const tt = (byId(`total_taxas_${prefix}`) || {}).value || '';
        texto = `PV sugerido: ${pv}\nTotal de taxas: ${tt}%`;
      }
      try { await navigator.clipboard.writeText(texto); } catch { }
    });

    recalc(prefix);
  }
}

window.addEventListener('DOMContentLoaded', attach);

// Debug helper: retorna a faixa/comissão da Shopee para um PV dado
function shopeeFaixaParaPV(pv) {
  for (const b of SHOPEE_BRACKETS) {
    const inRange = (b.min === undefined || pv >= b.min) && (b.max === undefined || pv < b.max);
    if (inRange) return { comissao: b.com, taxa_fixa: b.tf, faixa: `${b.min}..${b.max}` };
  }
  const last = SHOPEE_BRACKETS[SHOPEE_BRACKETS.length - 1];
  return { comissao: last.com, taxa_fixa: last.tf, faixa: `${last.min}..${last.max}` };
}
window.shopeeFaixaParaPV = shopeeFaixaParaPV;

// Modal: preenche e mostra simulação de faixas
function buildShopeeSimHtml(data) {
  if (!data) return '<p>Sem dados de simulação.</p>';
  const { pv, custo, pDas, pDesc, lower, higher } = data;
  let html = `<p class="muted">PV atual: ${fmtBRL.format(pv)} — Custo: ${fmtBRL.format(custo)}</p>`;

  // Mostra a tabela de faixas conforme solicitado
  html += '<h3>Tabela de Faixas</h3>';
  html += '<table><thead><tr><th>PV Estimado</th><th>Comissão %</th><th>TF (R$)</th></tr></thead><tbody>';
  for (const b of SHOPEE_BRACKETS) {
    let rangeLabel;
    if (b.max === Infinity) rangeLabel = `maior ${b.min}`;
    else if (!b.min || b.min === 0) rangeLabel = `até ${Number((b.max - 0.01).toFixed(2))}`;
    else rangeLabel = `${b.min} até ${Number((b.max - 0.01).toFixed(2))}`;
    html += `<tr><td>${rangeLabel}</td><td>${(b.com * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td><td>${fmtBRL.format(b.tf)}</td></tr>`;
  }
  html += '</tbody></table>';

  // Simulações comparativas (mantém testes em limites e PV atual)
  html += '<h3>Simulação</h3>';
  html += '<table><thead><tr><th>Teste PV</th><th>Faixa</th><th>Comissão</th><th>Taxa fixa</th><th>Lucro (R$)</th><th>Margem (%)</th></tr></thead><tbody>';

  function simulateFor(pvTest, bracket) {
    const com = bracket.com;
    const tf = bracket.tf;
    const vCom = pvTest * com;
    const vDas = pvTest * pDas;
    const vDesc = pvTest * pDesc;
    const total = vCom + vDas + vDesc + tf;
    const lucroSim = pvTest - custo - total;
    const margemSim = pvTest > 0 ? (lucroSim / pvTest) : 0;
    return { lucroSim, margemSim, com, tf };
  }

  function formatRange(b) {
    if (!b) return '';
    if (b.max === Infinity) return `>= ${b.min}`;
    if (!b.min || b.min === 0) return `até ${Number((b.max - 0.01).toFixed(2))}`;
    return `${b.min} até ${Number((b.max - 0.01).toFixed(2))}`;
  }

  if (lower) {
    const pvLowerTest = (lower.max === Infinity) ? lower.min : (Math.max(0, Number((lower.max - 0.01).toFixed(2))));
    const r = simulateFor(pvLowerTest, lower);
    html += `<tr><td>${fmtBRL.format(pvLowerTest)}</td><td>${formatRange(lower)}</td><td>${(r.com * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td><td>${fmtBRL.format(r.tf)}</td><td>${fmtBRL.format(r.lucroSim)}</td><td>${(r.margemSim * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</td></tr>`;
  }

  // faixa detectada para o PV atual — usa helper para consistência
  const detected = shopeeFaixaParaPV(pv);
  // reconstrói um objeto de faixa compatível para simulação
  const currentBracket = { com: detected.comissao || detected.comissao, tf: detected.taxa_fixa || detected.taxa_fixa };
  if (currentBracket) {
    const rcur = simulateFor(pv, { com: currentBracket.com, tf: currentBracket.tf });
    html += `<tr><td>${fmtBRL.format(pv)}</td><td>${detected.faixa}</td><td>${(rcur.com * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td><td>${fmtBRL.format(rcur.tf)}</td><td>${fmtBRL.format(rcur.lucroSim)}</td><td>${(rcur.margemSim * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</td></tr>`;
  }

  if (higher) {
    const pvHigherTest = Number((higher.min || 0).toFixed(2));
    const r2 = simulateFor(pvHigherTest, higher);
    html += `<tr><td>${fmtBRL.format(pvHigherTest)}</td><td>${formatRange(higher)}</td><td>${(r2.com * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%</td><td>${fmtBRL.format(r2.tf)}</td><td>${fmtBRL.format(r2.lucroSim)}</td><td>${(r2.margemSim * 100).toLocaleString('pt-BR', { minimumFractionDigits: 2 })}%</td></tr>`;
  }

  html += '</tbody></table>';
  return html;
}

function showShopeeSimModal() {
  const modal = byId('modal_sim');
  const body = byId('modal_body');
  if (!modal || !body) return;
  const data = window.lastShopeeSim || null;
  body.innerHTML = buildShopeeSimHtml(data);
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideShopeeSimModal() {
  const modal = byId('modal_sim');
  if (!modal) return;
  modal.classList.add('hidden');
  modal.setAttribute('aria-hidden', 'true');
}

document.addEventListener('click', (e) => {
  const simBtn = byId('simular_shopee_btn');
  if (simBtn && e.target === simBtn) {
    showShopeeSimModal();
  }
  const close = byId('modal_close');
  if (close && e.target === close) hideShopeeSimModal();
  // fechar ao clicar no overlay
  const modal = byId('modal_sim');
  if (modal && e.target === byId('modal_sim').querySelector('.modal-overlay')) hideShopeeSimModal();
});

// inicia a pagina com todos os imputs vazios e recalcula para mostrar valores zerados
window.addEventListener('DOMContentLoaded', () => {
  for (const prefix of marketplaces) {
    for (const f of fields.concat(prefix === 'ml' ? mlExtraFields : [])) {
      const el = byId(`${f}_${prefix}`);
      if (el) el.value = '';
    }
    if (prefix === 'ml') {
      ['classico', 'premium'].forEach(tipo => {
        const pvEl = byId(`pv_ml_${tipo}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
        const liqEl = byId(`liquido_ml_${tipo}`); if (liqEl) liqEl.textContent = 'R$ 0,00';
        const ttEl = byId(`total_taxas_ml_${tipo}`); if (ttEl) ttEl.value = '';
        const comEl = byId(`comissao_pct_ml_${tipo}`); if (comEl) comEl.value = '';
        const tfEl = byId(`tarifa_fixa_ml_${tipo}`); if (tfEl) tfEl.value = '';
      }
      );
    } else {
      const pvEl = byId(`pv_${prefix}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
      const ttEl = byId(`total_taxas_${prefix}`); if (ttEl) ttEl.value = '';
      const etap = byId(`etapas_${prefix}`); if (etap) etap.textContent = '';
    }
    const msg = byId(`msg_${prefix}`); if (msg) { msg.textContent = ''; msg.classList.add('hidden'); }
    recalc(prefix);
  }
});