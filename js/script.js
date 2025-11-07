// Utilidades de formato e parsing (suporta vírgula e ponto)
const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });

function parseDecimal(v) {
  if (v === null || v === undefined) return 0;
  if (typeof v !== 'string') v = String(v);
  v = v.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');
  const n = parseFloat(v);
  return isNaN(n) ? 0 : n;
}

const marketplaces = ['ml','shopee','magalu'];
const fields = ['custo','taxa_fixa','margem_lucro','comissao','subsidio','das','descontos','outras'];
const pctFields = ['margem_lucro','comissao','subsidio','das','descontos','outras'];

function byId(id) { return document.getElementById(id); }
function setText(id, t) { const el = byId(id); if (el) el.textContent = t; }

function saveState(prefix) {
  const key = `calc_${prefix}_v1`;
  const s = {};
  for (const f of fields) { const el = byId(`${f}_${prefix}`); if (el) s[f] = el.value; }
  localStorage.setItem(key, JSON.stringify(s));
}
function loadState(prefix) {
  try {
    const key = `calc_${prefix}_v1`;
    const raw = localStorage.getItem(key); if (!raw) return;
    const s = JSON.parse(raw);
    for (const f of fields) if (s[f] !== undefined) { const el = byId(`${f}_${prefix}`); if (el) el.value = s[f]; }
  } catch {}
}

function recalc(prefix) {
  saveState(prefix);
  const getPct = name => parseDecimal((byId(`${name}_${prefix}`)||{}).value) / 100;
  const getMoney = name => parseDecimal((byId(`${name}_${prefix}`)||{}).value);

  const custo = getMoney('custo');
  const taxaFixa = getMoney('taxa_fixa');
  const ml = getPct('margem_lucro');
  const pCom = getPct('comissao');
  const pSub = getPct('subsidio');
  const pDas = getPct('das');
  const pDesc = getPct('descontos');
  const pOutras = getPct('outras');

  const tt = pCom + pSub + pDas + pDesc + pOutras;
  const totalEl = byId(`total_taxas_${prefix}`);
  if (totalEl) totalEl.value = (tt*100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

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
    ['det_comissao','det_subsidio','det_das','det_descontos','det_outras','det_total_taxas','det_taxa_fixa','det_lucro','det_margem_efetiva']
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
  setText(`det_margem_efetiva_${prefix}`, (margemEfetiva*100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
}

function attach() {
  for (const prefix of marketplaces) {
    loadState(prefix);
    for (const f of fields) {
      const el = byId(`${f}_${prefix}`);
      if (!el) continue;
      el.addEventListener('input', () => recalc(prefix));
      el.addEventListener('blur', () => {
        const val = parseDecimal(el.value);
        const isPct = pctFields.includes(f);
        el.value = isPct
          ? val.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
          : val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      });
    }

    const resetBtn = byId(`resetBtn_${prefix}`);
    if (resetBtn) resetBtn.addEventListener('click', () => {
      for (const f of fields) { const el = byId(`${f}_${prefix}`); if (el) el.value = ''; }
      const pvEl = byId(`pv_${prefix}`); if (pvEl) pvEl.textContent = 'R$ 0,00';
      const ttEl = byId(`total_taxas_${prefix}`); if (ttEl) ttEl.value = '';
      const etap = byId(`etapas_${prefix}`); if (etap) etap.textContent = '';
      const msg = byId(`msg_${prefix}`); if (msg) { msg.textContent=''; msg.classList.add('hidden'); }
      recalc(prefix);
    });

    const copyBtn = byId(`copyBtn_${prefix}`);
    if (copyBtn) copyBtn.addEventListener('click', async () => {
      const pv = (byId(`pv_${prefix}`)||{}).textContent || '';
      const tt = (byId(`total_taxas_${prefix}`)||{}).value || '';
      const texto = `PV sugerido: ${pv}\nTotal de taxas: ${tt}%`;
      try { await navigator.clipboard.writeText(texto); } catch {}
    });

    recalc(prefix);
  }
}

window.addEventListener('DOMContentLoaded', attach);