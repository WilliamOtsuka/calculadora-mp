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

function getPct(id) { return parseDecimal(document.getElementById(id).value) / 100; }
function getMoney(id) { return parseDecimal(document.getElementById(id).value); }
function setText(id, text) { document.getElementById(id).textContent = text; }

const inputs = ['custo','taxa_fixa','margem_lucro','comissao','subsidio','das','descontos','outras'];

function saveState() {
  const state = {};
  for (const id of inputs) state[id] = document.getElementById(id).value;
  localStorage.setItem('calc_shopee_v1', JSON.stringify(state));
}
function loadState() {
  try {
    const s = localStorage.getItem('calc_shopee_v1');
    if (!s) return;
    const state = JSON.parse(s);
    for (const id of inputs) if (state[id] !== undefined) document.getElementById(id).value = state[id];
  } catch {}
}

function recalc() {
  saveState();
  const custo = getMoney('custo');
  const taxaFixa = getMoney('taxa_fixa');
  const ml = getPct('margem_lucro');
  const pCom = getPct('comissao');
  const pSub = getPct('subsidio');
  const pDas = getPct('das');
  const pDesc = getPct('descontos');
  const pOutras = getPct('outras');

  // Total de taxas (%): soma dos componentes (subsídio pode ser negativo)
  const tt = pCom + pSub + pDas + pDesc + pOutras;
  const ttPct = tt * 100;
  document.getElementById('total_taxas').value = ttPct.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const msg = document.getElementById('msg');
  msg.classList.add('hidden');
  msg.textContent = '';

  // Etapas
  const etapa1 = custo * (1 + ml);
  const etapa2 = etapa1 + taxaFixa;
  const denom = 1 - tt;

  if (denom <= 0) {
    setText('pv', '—');
    document.getElementById('etapas').innerHTML =
      `1) ${fmtBRL.format(etapa1)} | 2) ${fmtBRL.format(etapa2)} | 3) dividir por ${fmtPct.format(denom)}`;
  msg.classList.remove('hidden');
  msg.textContent = 'O total de taxas é maior ou igual a 100%. Ajuste os percentuais para conseguir calcular o PV.';
    // Zera detalhamento
    ['det_comissao','det_subsidio','det_das','det_descontos','det_outras','det_total_taxas','det_taxa_fixa','det_lucro','det_margem_efetiva']
      .forEach(id => setText(id, id === 'det_margem_efetiva' ? '0,00%' : fmtBRL.format(0)));
    return;
  }

  const pv = etapa2 / denom;

  // Detalhamento em R$
  const vCom = pv * pCom;
  const vSub = pv * pSub; // pode ser negativo
  const vDas = pv * pDas;
  const vDes = pv * pDesc;
  const vOut = pv * pOutras;
  const vTotTaxas = pv * tt;

  // Lucro estimado em R$: diferença entre PV e (custo + taxas em R$ + taxa fixa)
  const lucro = pv - custo - vTotTaxas - taxaFixa;
  const margemEfetiva = pv > 0 ? (lucro / pv) : 0;

  setText('pv', fmtBRL.format(pv));
  document.getElementById('etapas').innerHTML =
    `1) ${fmtBRL.format(etapa1)} | 2) ${fmtBRL.format(etapa2)} | 3) dividir por ${fmtPct.format(denom)}`;

  setText('det_comissao', fmtBRL.format(vCom));
  setText('det_subsidio', fmtBRL.format(vSub));
  setText('det_das', fmtBRL.format(vDas));
  setText('det_descontos', fmtBRL.format(vDes));
  setText('det_outras', fmtBRL.format(vOut));
  setText('det_total_taxas', fmtBRL.format(vTotTaxas));
  setText('det_taxa_fixa', fmtBRL.format(taxaFixa));
  setText('det_lucro', fmtBRL.format(lucro));
  setText('det_margem_efetiva', (margemEfetiva*100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + '%');
}

function attach() {
  loadState();
  for (const id of inputs) {
    const el = document.getElementById(id);
    el.addEventListener('input', recalc);
    el.addEventListener('blur', () => { // formata levemente em blur
      const isPct = ['margem_lucro','comissao','subsidio','das','descontos','outras'].includes(id);
      const val = parseDecimal(el.value);
      el.value = isPct
        ? val.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
        : val.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    });
  }

  document.getElementById('resetBtn').addEventListener('click', () => {
    document.getElementById('custo').value = '';
    document.getElementById('taxa_fixa').value = '';
    document.getElementById('margem_lucro').value = '';
    document.getElementById('comissao').value = '';
    document.getElementById('subsidio').value = '';
    document.getElementById('das').value = '';
    document.getElementById('descontos').value = '';
    document.getElementById('outras').value = '';
    recalc();
  });
  document.getElementById('copyBtn').addEventListener('click', async () => {
    const pv = document.getElementById('pv').textContent;
    const tt = document.getElementById('total_taxas').value.replace('.', ',');
    const texto = `PV sugerido: ${pv}\nTotal de taxas: ${tt}%`;
    try { await navigator.clipboard.writeText(texto); } catch {}
  });
  recalc();
}
window.addEventListener('DOMContentLoaded', attach);