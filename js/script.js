const fmtBRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = new Intl.NumberFormat('pt-BR', {
  style: 'percent',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2
});

const MARKETPLACES = ['ml', 'shopee', 'magalu'];
const BASE_FIELDS = ['custo', 'embalagem', 'taxa_fixa', 'margem_lucro', 'comissao', 'subsidio', 'das', 'descontos', 'outras', 'spike_day'];
const PERCENT_FIELDS = ['margem_lucro', 'comissao', 'subsidio', 'das', 'descontos', 'outras', 'spike_day', 'ads'];
const ML_EXTRA_FIELDS = ['categoria', 'custos_adic', 'impostos', 'ads'];
const MAGALU_EXTRA_FIELDS = ['categoria', 'peso_real', 'altura', 'largura', 'comprimento', 'frete_base', 'sla_envio'];
const SHARED_FIELDS = ['custo', 'embalagem', 'margem_lucro', 'das', 'descontos', 'spike_day'];
const ZERO_CURRENCY = 'R$ 0,00';
const ML_COMISSAO_CLASSICO = 0.14;
const ML_COMISSAO_PREMIUM = 0.19;
const ML_IMPOSTO_SIMPLES = 0.09;
const ML_ADS_TAXA = 0.05;
const MAGALU_COMISSAO = 0.148;
const MAGALU_FRETE_GRATIS_THRESHOLD = 79;
let isMargemLucroLinked = false;

const PV_ALERT_TARGETS = {
  ml: [
    '.market-card.ml .variant-card:nth-child(1) .result .result-secondary',
    '.market-card.ml .variant-card:nth-child(2) .result .result-secondary'
  ],
  shopee: ['.market-card.shopee .result-secondary'],
  magalu: ['.market-card.magalu .result-secondary']
};

const PV_ALERT_REQUIRED_FIELDS = {
  ml: [
    { id: 'shared_custo', label: 'Custo do produto' },
    { id: 'shared_embalagem', label: 'Custo da embalagem' },
    { id: 'shared_margem_lucro', label: 'Margem de lucro' },
    { id: 'custos_adic_ml', label: 'Frete' }
  ],
  shopee: [
    { id: 'shared_custo', label: 'Custo do produto' },
    { id: 'shared_embalagem', label: 'Custo da embalagem' },
    { id: 'shared_margem_lucro', label: 'Margem de lucro' },
    { id: 'shared_das', label: 'DAS Simples' },
    { id: 'shared_descontos', label: 'Margem p/ descontos' },
    { id: 'spike_day_shopee', label: 'Spike Day' }
  ],
  magalu: [
    { id: 'shared_custo', label: 'Custo do produto' },
    { id: 'shared_embalagem', label: 'Custo da embalagem' },
    { id: 'shared_margem_lucro', label: 'Margem de lucro' },
    { id: 'shared_das', label: 'DAS Simples' },
    { id: 'shared_descontos', label: 'Margem p/ descontos' },
    { id: 'categoria_magalu', label: 'Categoria' },
    { id: 'peso_real_magalu', label: 'Peso real' },
    { id: 'altura_magalu', label: 'Altura' },
    { id: 'largura_magalu', label: 'Largura' },
    { id: 'comprimento_magalu', label: 'Comprimento' },
    { id: 'frete_base_magalu', label: 'Frete base' }
  ]
};

const MAGALU_FREIGHT_TABLE = [
  { max: 0.5,   base: 35.90 },
  { max: 1,     base: 40.90 },
  { max: 2,     base: 42.90 },
  { max: 5,     base: 50.90 },
  { max: 9,     base: 77.90 },
  { max: 13,    base: 98.90 },
  { max: 17,    base: 111.90 },
  { max: 23,    base: 134.90 },
  { max: 30,    base: 148.90 },
  { max: 40,    base: 159.90 },
  { max: 50,    base: 189.90 },
  { max: 60,    base: 197.90 },
  { max: 70,    base: 206.90 },
  { max: 80,    base: 215.90 },
  { max: 90,    base: 225.90 },
  { max: 100,   base: 235.90 },
  { max: 110,   base: 245.90 },
  { max: 120,   base: 256.90 },
  { max: 130,   base: 267.90 },
  { max: 140,   base: 279.90 },
  { max: 150,   base: 291.90 },
  { max: 160,   base: 304.90 },
  { max: 170,   base: 317.90 },
  { max: 180,   base: 331.90 },
  { max: 190,   base: 345.90 },
  { max: 200,   base: 360.90 },
  { max: Infinity, base: 375.90 }
];

function getMagaluFreteBase(pesoKg) {
  const row = MAGALU_FREIGHT_TABLE.find(r => pesoKg <= r.max);
  return row ? row.base : MAGALU_FREIGHT_TABLE[MAGALU_FREIGHT_TABLE.length - 1].base;
}

const SHOPEE_BRACKETS = [
  { min: 0, max: 79.999999, com: 0.20, tf: 4 },
  { min: 80, max: 99.999999, com: 0.14, tf: 16 },
  { min: 100, max: 199.999999, com: 0.14, tf: 20 },
  { min: 200, max: Infinity, com: 0.14, tf: 26 }
];

function byId(id) {
  return document.getElementById(id);
}

function setText(id, text) {
  const element = byId(id);
  if (element) element.textContent = text;
}

function setValue(id, value) {
  const element = byId(id);
  if (element) element.value = value;
}

function hasMeaningfulValue(element) {
  if (!element) return false;

  if (element.tagName === 'SELECT') {
    return String(element.value || '').trim() !== '';
  }

  const raw = String(element.value || '').trim();
  if (!raw) return false;

  const normalized = raw
    .replace(/R\$\s?/gi, '')
    .replace(/%/g, '')
    .replace(/\s+/g, '');

  return normalized !== '';
}

function getMissingRequiredFields(prefix) {
  const required = PV_ALERT_REQUIRED_FIELDS[prefix] || [];
  const missing = [];

  for (const field of required) {
    const element = byId(field.id);
    if (!hasMeaningfulValue(element)) {
      missing.push(field.label);
    }
  }

  return missing;
}

function updatePvMissingAlert(prefix) {
  const missingFields = getMissingRequiredFields(prefix);
  const tooltip = `Campos faltantes: ${missingFields.join(', ')}`;
  const selectors = PV_ALERT_TARGETS[prefix] || [];

  selectors.forEach((_, index) => {
    const alert = byId(`pv_missing_alert_${prefix}_${index}`);
    if (!alert) return;

    if (!missingFields.length) {
      alert.classList.add('hidden');
      alert.removeAttribute('title');
      alert.removeAttribute('aria-label');
      return;
    }

    alert.classList.remove('hidden');
    alert.title = tooltip;
    alert.setAttribute('aria-label', tooltip);
  });
}

function initPvMissingAlerts() {
  Object.entries(PV_ALERT_TARGETS).forEach(([prefix, selectors]) => {
    selectors.forEach((selector, index) => {
      const title = document.querySelector(selector);
      if (!title) return;

      if (byId(`pv_missing_alert_${prefix}_${index}`)) return;

      const alert = document.createElement('span');
      alert.id = `pv_missing_alert_${prefix}_${index}`;
      alert.className = 'missing-fields-alert hidden';
      alert.textContent = '!';
      title.appendChild(alert);
    });
  });

  updatePvMissingAlert('ml');
  updatePvMissingAlert('shopee');
  updatePvMissingAlert('magalu');
}

function getMarketplaceFields(prefix) {
  if (prefix === 'ml') return BASE_FIELDS.concat(ML_EXTRA_FIELDS);
  if (prefix === 'magalu') return BASE_FIELDS.concat(MAGALU_EXTRA_FIELDS);
  return BASE_FIELDS;
}

function parseDecimal(value) {
  if (value === null || value === undefined) return 0;

  let normalized = typeof value === 'string' ? value : String(value);
  normalized = normalized.replace(/R\$\s?/gi, '');
  normalized = normalized.replace(/\s+/g, '').replace(/\./g, '').replace(',', '.');

  const parsed = parseFloat(normalized);
  return Number.isNaN(parsed) ? 0 : parsed;
}

function sanitizeNumberString(value, maxDecimals = 2) {
  if (value == null) return '';

  let normalized = String(value).replace(/[^0-9.,]/g, '');

  if (normalized.includes(',')) {
    normalized = normalized.replace(/\./g, '');
  } else if (normalized.includes('.')) {
    let firstDot = true;
    normalized = normalized.replace(/\./g, () => {
      if (firstDot) {
        firstDot = false;
        return ',';
      }
      return '';
    });
  }

  let hasComma = false;
  let output = '';
  for (const char of normalized) {
    if (char === ',') {
      if (hasComma) continue;
      hasComma = true;
    }
    output += char;
  }

  if (hasComma && maxDecimals >= 0) {
    const [integerPart, decimalPart = ''] = output.split(',');
    output = `${integerPart},${decimalPart.slice(0, maxDecimals)}`;
  }

  return output;
}

function formatNumber(value, decimals = 2) {
  return value.toLocaleString('pt-BR', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals
  });
}

function formatPercentDisplay(rate, decimals = 2) {
  return `${formatNumber(rate * 100, decimals)}%`;
}

function showMessage(prefix, text = '', visible = false) {
  const message = byId(`msg_${prefix}`);
  if (!message) return;

  message.textContent = text;
  message.classList.toggle('hidden', !visible);
}

function getFieldValue(name, prefix) {
  return (byId(`${name}_${prefix}`) || {}).value;
}

function getMoneyField(name, prefix) {
  return parseDecimal(getFieldValue(name, prefix));
}

function getPercentField(name, prefix) {
  return parseDecimal(getFieldValue(name, prefix)) / 100;
}

function getNumberField(name, prefix) {
  return parseDecimal(getFieldValue(name, prefix));
}

function saveState(prefix) {
  const state = {};
  for (const field of getMarketplaceFields(prefix)) {
    const element = byId(`${field}_${prefix}`);
    if (element) state[field] = element.value;
  }
  localStorage.setItem(`calc_${prefix}_v1`, JSON.stringify(state));
}

function loadState(prefix) {
  try {
    const raw = localStorage.getItem(`calc_${prefix}_v1`);
    if (!raw) return;

    const state = JSON.parse(raw);
    for (const field of getMarketplaceFields(prefix)) {
      if (state[field] === undefined) continue;

      const element = byId(`${field}_${prefix}`);
      if (element) element.value = state[field];
    }
  } catch {
  }
}

function resetMlOutputs() {
  ['classico', 'premium'].forEach((tipo) => {
    setText(`pv_ml_${tipo}`, ZERO_CURRENCY);
    setText(`liquido_ml_${tipo}`, ZERO_CURRENCY);
    setValue(`total_taxas_ml_${tipo}`, '');
    setValue(`comissao_pct_ml_${tipo}`, '');
  });
}

function resetDefaultOutputs(prefix) {
  setText(`pv_${prefix}`, ZERO_CURRENCY);
  setValue(`total_taxas_${prefix}`, '');
  const steps = byId(`etapas_${prefix}`);
  if (steps) steps.textContent = '';
}

function resetMarketplaceOutputs(prefix) {
  if (prefix === 'ml') {
    resetMlOutputs();
  } else {
    resetDefaultOutputs(prefix);
  }

  showMessage(prefix);
}

function clearMarketplaceFields(prefix) {
  for (const field of getMarketplaceFields(prefix)) {
    const element = byId(`${field}_${prefix}`);
    if (!element) continue;

    if (element.tagName === 'SELECT') {
      const defaultOption = Array.from(element.options || []).find((option) => option.defaultSelected);
      element.value = defaultOption ? defaultOption.value : '';
      continue;
    }

    element.value = '';
  }
}

function getShopeeBracketForPrice(pv) {
  for (const bracket of SHOPEE_BRACKETS) {
    if (pv >= bracket.min && pv < bracket.max) {
      return {
        comissao: bracket.com,
        taxa_fixa: bracket.tf,
        faixa: `${bracket.min}..${bracket.max}`
      };
    }
  }

  const lastBracket = SHOPEE_BRACKETS[SHOPEE_BRACKETS.length - 1];
  return {
    comissao: lastBracket.com,
    taxa_fixa: lastBracket.tf,
    faixa: `${lastBracket.min}..${lastBracket.max}`
  };
}

function magaluCategoryToTaxaFixa(categoria) {
  switch (categoria) {
    case 'Alimentos':
      return 2;
    case 'Utilidades':
      return 5;
    default:
      return 0;
  }
}

function normalizeCategoryText(value) {
  return extractCategoryText(value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function extractCategoryText(value) {
  if (!value) return '';

  if (typeof value === 'string') return value;

  if (Array.isArray(value)) {
    return value
      .map((item) => extractCategoryText(item))
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
      .map((item) => extractCategoryText(item))
      .filter(Boolean)
      .join(' ');
  }

  return String(value);
}

function inferMagaluCategoryFromTiny(categoriaTiny) {
  const normalized = normalizeCategoryText(categoriaTiny);
  if (!normalized) return '';

  const alimentoKeywords = [
    'alimentos',
    'arroz',
    'bebidas',
    'caseiros',
    'chas',
    'doces',
    'enlatados',
    'massas',
    'molhos',
    'naturais',
    'saude',
    'temperos',
    'condimentos'
  ];

  const utilidadesKeywords = [
    'utensilios',
    'religiosos',
    'presentes',
    'mais categorias',
    'casa',
    'calcados',
    'copos',
    'artigos religiosos'
  ];

  if (alimentoKeywords.some((keyword) => normalized.includes(keyword))) {
    return 'Alimentos';
  }

  if (utilidadesKeywords.some((keyword) => normalized.includes(keyword))) {
    return 'Utilidades';
  }

  return '';
}

function applyMagaluCategorySelection(categoria) {
  const categoriaEl = byId('categoria_magalu');
  const taxaEl = byId('taxa_fixa_magalu');
  if (!taxaEl) return;

  if (categoriaEl && categoriaEl.value !== categoria) {
    categoriaEl.value = categoria;
  }

  const taxa = magaluCategoryToTaxaFixa(categoria);
  if (taxa > 0) {
    taxaEl.value = fmtBRL.format(taxa);
    taxaEl.readOnly = true;
  } else {
    if (!taxaEl.value || parseDecimal(taxaEl.value) === 0) taxaEl.value = '';
    taxaEl.readOnly = false;
  }
}

function getMagaluFreightDiscount() {
  const raw = String(getFieldValue('sla_envio', 'magalu') || '').trim();
  if (!raw) return 0;


  const normalized = raw.replace(',', '.');
  const numeric = Number(normalized);
  if (!Number.isFinite(numeric)) return 0;

  if (numeric > 1) return numeric / 100;
  if (numeric < 0) return 0;
  return numeric;
}

function computeMagaluResult() {
  const custo = getMoneyField('custo', 'magalu');
  const embalagem = getMoneyField('embalagem', 'magalu');
  const taxaFixa = getMoneyField('taxa_fixa', 'magalu');
  const margemLucro = getPercentField('margem_lucro', 'magalu');
  const pDas = getPercentField('das', 'magalu');
  const pDesc = getPercentField('descontos', 'magalu');
  const pOutras = getPercentField('outras', 'magalu');
  const pCom = MAGALU_COMISSAO;

  const pesoReal = getNumberField('peso_real', 'magalu');
  const altura = getNumberField('altura', 'magalu');
  const largura = getNumberField('largura', 'magalu');
  const comprimento = getNumberField('comprimento', 'magalu');
  const freteBase = getMoneyField('frete_base', 'magalu');
  const descontoFrete = getMagaluFreightDiscount();

  const pesoCubado = (altura * largura * comprimento) / 6000;
  const pesoConsiderado = Math.max(pesoReal, pesoCubado);
  const freteLoja = freteBase;

  const percentuais = pCom + pDas + pDesc + pOutras + margemLucro;
  const totalTaxasPct = pCom + pDas + pDesc + pOutras;
  const denominador = 1 - percentuais;

  if (denominador <= 0) {
    return {
      invalido: true,
      totalTaxasPct,
      pesoCubado,
      pesoConsiderado,
      freteLoja,
      descontoFrete,
      pCom
    };
  }

  const custoBase = custo + embalagem + taxaFixa;
  const pvSemFrete = custoBase / denominador;
  const pvComFrete = (custoBase + freteLoja) / denominador;

  let pv = pvSemFrete;
  let freteAplicado = 0;

  const semFreteValido = pvSemFrete <= MAGALU_FRETE_GRATIS_THRESHOLD;
  const comFreteValido = pvComFrete > MAGALU_FRETE_GRATIS_THRESHOLD;

  if (!semFreteValido && comFreteValido) {
    pv = pvComFrete;
    freteAplicado = freteLoja;
  } else if (semFreteValido) {
    pv = pvSemFrete;
    freteAplicado = 0;
  } else {
    pv = pvComFrete;
    freteAplicado = freteLoja;
  }

  const vCom = pv * pCom;
  const vDas = pv * pDas;
  const vDesc = pv * pDesc;
  const vOutras = pv * pOutras;
  const totalTaxasValor = vCom + vDas + vDesc + vOutras + taxaFixa + freteAplicado;
  const lucro = pv - custo - embalagem - totalTaxasValor;
  const margemEfetiva = pv > 0 ? lucro / pv : 0;

  return {
    invalido: false,
    pv,
    vCom,
    vDas,
    vDesc,
    vOutras,
    totalTaxasValor,
    lucro,
    margemEfetiva,
    totalTaxasPct,
    pesoCubado,
    pesoConsiderado,
    freteLoja,
    freteAplicado,
    descontoFrete,
    pCom,
    taxaFixa,
    comFreteGratis: freteAplicado > 0
  };
}

function recalcMagalu() {
  showMessage('magalu');

  const comissaoEl = byId('comissao_magalu');
  const descontoEl = byId('subsidio_magalu');
  if (comissaoEl) {
    comissaoEl.value = formatNumber(MAGALU_COMISSAO * 100, 2);
    comissaoEl.readOnly = true;
  }
  if (descontoEl) {
    descontoEl.value = formatNumber(getMagaluFreightDiscount() * 100, 2);
    descontoEl.readOnly = true;
  }

  const pesoReal = getNumberField('peso_real', 'magalu');
  const altura = getNumberField('altura', 'magalu');
  const largura = getNumberField('largura', 'magalu');
  const comprimento = getNumberField('comprimento', 'magalu');
  if (pesoReal > 0 || (altura > 0 && largura > 0 && comprimento > 0)) {
    const pesoCubado = (altura * largura * comprimento) / 6000;
    const pesoConsiderado = Math.max(pesoReal, pesoCubado);
    const freteBase = getMagaluFreteBase(pesoConsiderado) * (1 - getMagaluFreightDiscount());
    const freteBaseEl = byId('frete_base_magalu');
    if (freteBaseEl) {
      freteBaseEl.value = formatNumber(freteBase, 2);
      freteBaseEl.readOnly = true;
    }
  }

  const result = computeMagaluResult();
  setValue('total_taxas_magalu', formatNumber(result.totalTaxasPct, 3));

  if (result.invalido) {
    setText('pv_magalu', '—');
    setText('det_comissao_magalu', fmtBRL.format(0));
    setText('det_subsidio_magalu', fmtBRL.format(0));
    setText('det_das_magalu', fmtBRL.format(0));
    setText('det_descontos_magalu', fmtBRL.format(0));
    setText('det_outras_magalu', fmtBRL.format(0));
    setText('det_total_taxas_magalu', fmtBRL.format(0));
    setText('det_taxa_fixa_magalu', fmtBRL.format(0));
    setText('det_lucro_magalu', fmtBRL.format(0));
    setText('det_margem_efetiva_magalu', '0%');
    showMessage('magalu', 'O total de taxas e margem desejada é maior ou igual a 100%.', true);
    return;
  }

  setText('pv_magalu', fmtBRL.format(result.pv));
  setText('det_comissao_magalu', fmtBRL.format(result.vCom));
  setText('det_subsidio_magalu', fmtBRL.format(result.freteAplicado));
  setText('det_das_magalu', fmtBRL.format(result.vDas));
  setText('det_descontos_magalu', fmtBRL.format(result.vDesc));
  setText('det_outras_magalu', fmtBRL.format(result.vOutras));
  setText('det_total_taxas_magalu', fmtBRL.format(result.totalTaxasValor));
  setText('det_taxa_fixa_magalu', fmtBRL.format(result.taxaFixa));
  setText('det_lucro_magalu', fmtBRL.format(result.lucro));
  setText('det_margem_efetiva_magalu', formatPercentDisplay(result.margemEfetiva));

  const shippingMode = result.comFreteGratis
    ? 'Frete considerado porque o PV ficou acima de R$ 79,00.'
    : 'Frete não considerado porque o PV ficou abaixo de R$ 79,00.';
  showMessage('magalu', `${shippingMode} Peso cubado: ${formatNumber(result.pesoCubado, 2)} kg | Peso considerado: ${formatNumber(result.pesoConsiderado, 2)} kg.`, true);
}

function computeMlOffer({ custo, embalagem, margemLucro, frete, tipo }) {
  const comissao = tipo === 'premium' ? ML_COMISSAO_PREMIUM : ML_COMISSAO_CLASSICO;
  const impostosPct = ML_IMPOSTO_SIMPLES;
  const adsPct = getPercentField('ads', 'ml');
  const pDesc = getPercentField('descontos', 'ml');
  const totalTaxas = comissao + impostosPct + adsPct + pDesc;
  const denominador = 1 - (comissao + impostosPct + adsPct + pDesc + margemLucro);
  const custoBase = custo + embalagem + frete;

  if (denominador <= 0) {
    return {
      pv: 0,
      vCom: 0,
      vImp: 0,
      vAds: 0,
      vDesc: 0,
      embalagem,
      custosAdic: frete,
      liquido: 0,
      lucro: 0,
      margem: 0,
      tt: totalTaxas,
      comissao,
      invalido: true
    };
  }

  const pv = custoBase / denominador;
  const vCom = pv * comissao;
  const vImp = pv * impostosPct;
  const vAds = pv * adsPct;
  const vDesc = pv * pDesc;
  const totalDeducoes = vCom + vImp + vAds + vDesc + frete;
  const liquido = pv - vCom - vImp - vAds - vDesc - frete;
  const lucro = liquido - custo - embalagem;
  const margem = pv > 0 ? lucro / pv : 0;

  return {
    pv,
    vCom,
    vImp,
    vAds,
    vDesc,
    embalagem,
    custosAdic: frete,
    totalDeducoes,
    liquido,
    lucro,
    margem,
    tt: totalTaxas,
    comissao,
    invalido: false
  };
}

function fillMlOffer(tipo, result) {
  setValue(`total_taxas_ml_${tipo}`, formatNumber(result.tt * 100, 2));
  setValue(`comissao_pct_ml_${tipo}`, formatNumber(result.comissao * 100, 2));

  if (result.invalido) {
    setText(`pv_ml_${tipo}`, '—');
    setText(`liquido_ml_${tipo}`, '—');
    return;
  }

  setText(`pv_ml_${tipo}`, fmtBRL.format(result.pv));
  setText(`liquido_ml_${tipo}`, fmtBRL.format(result.liquido));
}

function fillMlDetail(tipo, offer) {
  const suffix = `ml_${tipo}`;

  if (!offer) {
    setText(`det_comissao_${suffix}`, fmtBRL.format(0));
    setText(`det_impostos_${suffix}`, fmtBRL.format(0));
    setText(`det_ads_${suffix}`, fmtBRL.format(0));
    setText(`det_descontos_${suffix}`, fmtBRL.format(0));
    setText(`det_custos_adic_${suffix}`, fmtBRL.format(0));
    setText(`det_embalagem_${suffix}`, fmtBRL.format(0));
    setText(`det_total_taxas_${suffix}`, fmtBRL.format(0));
    setText(`det_liquido_${suffix}`, fmtBRL.format(0));
    setText(`det_lucro_${suffix}`, fmtBRL.format(0));
    setText(`det_margem_efetiva_${suffix}`, '0%');
    return;
  }

  setText(`det_comissao_${suffix}`, fmtBRL.format(offer.vCom || 0));
  setText(`det_impostos_${suffix}`, fmtBRL.format(offer.vImp || 0));
  setText(`det_ads_${suffix}`, fmtBRL.format(offer.vAds || 0));
  setText(`det_descontos_${suffix}`, fmtBRL.format(offer.vDesc || 0));
  setText(`det_custos_adic_${suffix}`, fmtBRL.format(offer.custosAdic || 0));
  setText(`det_embalagem_${suffix}`, fmtBRL.format(offer.embalagem || 0));
  setText(`det_total_taxas_${suffix}`, fmtBRL.format(offer.totalDeducoes || 0));
  setText(`det_liquido_${suffix}`, fmtBRL.format(offer.liquido || 0));
  setText(`det_lucro_${suffix}`, fmtBRL.format(offer.lucro || 0));
  setText(`det_margem_efetiva_${suffix}`, formatPercentDisplay(offer.margem || 0));
}

function recalcMercadoLivre() {
  const custo = getMoneyField('custo', 'ml');
  const embalagem = getMoneyField('embalagem', 'ml');
  const margemLucro = getPercentField('margem_lucro', 'ml');
  const frete = getMoneyField('custos_adic', 'ml');

  const impostosEl = byId('impostos_ml');
  if (impostosEl) {
    impostosEl.value = formatNumber(ML_IMPOSTO_SIMPLES * 100, 2);
    impostosEl.readOnly = true;
  }

  showMessage('ml');

  const classico = computeMlOffer({ custo, embalagem, margemLucro, frete, tipo: 'classico' });
  const premium = computeMlOffer({ custo, embalagem, margemLucro, frete, tipo: 'premium' });

  fillMlOffer('classico', classico);
  fillMlOffer('premium', premium);
  fillMlDetail('classico', classico);
  fillMlDetail('premium', premium);

  if (classico.invalido || premium.invalido) {
    showMessage('ml', 'O total de comissao, imposto simples, ADS, margem p/ descontos e margem desejada e maior ou igual a 100%.', true);
  }
}

function computeShopeeResult() {
  const custo = getMoneyField('custo', 'shopee');
  const embalagem = getMoneyField('embalagem', 'shopee');
  const margemLucro = getPercentField('margem_lucro', 'shopee');
  const pDas = getPercentField('das', 'shopee');
  const pDesc = getPercentField('descontos', 'shopee');
  const pSpike = getPercentField('spike_day', 'shopee');

  let pv = 0;
  let comissaoBase = 0;
  let taxaFixa = 0;

  for (const bracket of SHOPEE_BRACKETS) {
    const totalPct = bracket.com + pDas + pDesc + pSpike + margemLucro;
    const denominador = 1 - totalPct;
    if (denominador <= 0) continue;

    const pvCalculado = (custo + embalagem + bracket.tf) / denominador;
    if (pvCalculado >= bracket.min && pvCalculado < bracket.max) {
      pv = pvCalculado;
      comissaoBase = bracket.com;
      taxaFixa = bracket.tf;
      break;
    }
  }

  if (pv <= 0) {
    const lastBracket = SHOPEE_BRACKETS[SHOPEE_BRACKETS.length - 1];
    const totalPct = lastBracket.com + pDas + pDesc + pSpike + margemLucro;
    const denominador = 1 - totalPct;
    if (denominador > 0) {
      pv = (custo + embalagem + lastBracket.tf) / denominador;
      comissaoBase = lastBracket.com;
      taxaFixa = lastBracket.tf;
    }
  }

  const vCom = pv * comissaoBase;
  const vDas = pv * pDas;
  const vDesc = pv * pDesc;
  const vSpike = pv * pSpike;
  const vMargemLucro = pv * margemLucro;
  const totalTaxasValor = vCom + vMargemLucro + vDas + vDesc + vSpike + taxaFixa;
  const lucro = pv - custo - totalTaxasValor;
  const margemEfetiva = pv > 0 ? lucro / pv : 0;

  let faixaIdx = SHOPEE_BRACKETS.findIndex((bracket) => pv >= bracket.min && pv < bracket.max);
  if (faixaIdx === -1) faixaIdx = SHOPEE_BRACKETS.length - 1;

  return {
    pv,
    custo,
    margemLucro,
    pDas,
    pDesc,
    pSpike,
    comissaoBase,
    taxaFixa,
    vCom,
    vDas,
    vDesc,
    vSpike,
    vMargemLucro,
    totalTaxasValor,
    lucro,
    margemEfetiva,
    totalTaxasPct: comissaoBase + pDas + pDesc + pSpike + margemLucro,
    faixaIdx,
    lower: faixaIdx > 0 ? SHOPEE_BRACKETS[faixaIdx - 1] : null,
    higher: faixaIdx + 1 < SHOPEE_BRACKETS.length ? SHOPEE_BRACKETS[faixaIdx + 1] : null
  };
}

function recalcShopee() {
  showMessage('shopee');

  const result = computeShopeeResult();
  setText('pv_shopee', result.pv > 0 ? fmtBRL.format(result.pv) : '—');
  setValue('comissao_shopee', (result.comissaoBase * 100).toLocaleString('pt-BR', { maximumFractionDigits: 2 }));
  setValue('taxa_fixa_shopee', fmtBRL.format(result.taxaFixa));
  setValue('total_taxas_shopee', result.totalTaxasPct.toLocaleString('pt-BR', { minimumFractionDigits: 3, maximumFractionDigits: 3 }));

  setText('det_comissao_shopee', fmtBRL.format(result.vCom));
  setText('det_das_shopee', fmtBRL.format(result.vDas));
  setText('det_descontos_shopee', fmtBRL.format(result.vDesc));
  setText('det_spike_shopee', fmtBRL.format(result.vSpike));
  setText('det_margem_lucro_shopee', fmtBRL.format(result.vMargemLucro));
  setText('det_total_taxas_shopee', fmtBRL.format(result.totalTaxasValor));
  setText('det_taxa_fixa_shopee', fmtBRL.format(result.taxaFixa));
  setText('det_lucro_shopee', fmtBRL.format(result.lucro));
  setText('det_margem_efetiva_shopee', formatPercentDisplay(result.margemEfetiva));

  window.lastShopeeSim = {
    pv: result.pv,
    faixaIdx: result.faixaIdx,
    custo: result.custo,
    margemLucro: result.margemLucro,
    pDas: result.pDas,
    pDesc: result.pDesc,
    pSpike: result.pSpike,
    lower: result.lower,
    higher: result.higher
  };
}

function recalcDefaultMarketplace(prefix) {
  const custo = getMoneyField('custo', prefix);
  const taxaFixa = getMoneyField('taxa_fixa', prefix);
  const margemLucro = getPercentField('margem_lucro', prefix);
  const pCom = getPercentField('comissao', prefix);
  const pSub = getPercentField('subsidio', prefix);
  const pDas = getPercentField('das', prefix);
  const pDesc = getPercentField('descontos', prefix);
  const pOutras = getPercentField('outras', prefix);
  const totalTaxas = pCom + pSub + pDas + pDesc + pOutras;

  setValue(`total_taxas_${prefix}`, formatNumber(totalTaxas * 100, 2));
  showMessage(prefix);

  const etapa1 = custo * (1 + margemLucro);
  const etapa2 = etapa1 + taxaFixa;
  const denominador = 1 - totalTaxas;

  const steps = byId(`etapas_${prefix}`);
  if (steps) {
    steps.innerHTML = `1) ${fmtBRL.format(etapa1)} | 2) ${fmtBRL.format(etapa2)} | 3) dividir por ${fmtPct.format(denominador)}`;
  }

  if (denominador <= 0) {
    setText(`pv_${prefix}`, '—');
    ['det_comissao', 'det_subsidio', 'det_das', 'det_descontos', 'det_outras', 'det_total_taxas', 'det_taxa_fixa', 'det_lucro', 'det_margem_efetiva']
      .forEach((id) => setText(`${id}_${prefix}`, id.endsWith('margem_efetiva') ? '0%' : fmtBRL.format(0)));
    showMessage(prefix, 'O total de taxas é maior ou igual a 100%.', true);
    return;
  }

  const pv = etapa2 / denominador;
  const vCom = pv * pCom;
  const vSub = pv * pSub;
  const vDas = pv * pDas;
  const vDesc = pv * pDesc;
  const vOutras = pv * pOutras;
  const totalTaxasValor = pv * totalTaxas;
  const lucro = pv - custo - totalTaxasValor - taxaFixa;
  const margemEfetiva = pv > 0 ? lucro / pv : 0;

  setText(`pv_${prefix}`, fmtBRL.format(pv));
  setText(`det_comissao_${prefix}`, fmtBRL.format(vCom));
  setText(`det_subsidio_${prefix}`, fmtBRL.format(vSub));
  setText(`det_das_${prefix}`, fmtBRL.format(vDas));
  setText(`det_descontos_${prefix}`, fmtBRL.format(vDesc));
  setText(`det_outras_${prefix}`, fmtBRL.format(vOutras));
  setText(`det_total_taxas_${prefix}`, fmtBRL.format(totalTaxasValor));
  setText(`det_taxa_fixa_${prefix}`, fmtBRL.format(taxaFixa));
  setText(`det_lucro_${prefix}`, fmtBRL.format(lucro));
  setText(`det_margem_efetiva_${prefix}`, formatPercentDisplay(margemEfetiva));
}

function recalc(prefix) {
  saveState(prefix);

  if (prefix === 'ml') {
    recalcMercadoLivre();
    updatePvMissingAlert('ml');
    updatePvMissingAlert('shopee');
    updatePvMissingAlert('magalu');
    return;
  }

  if (prefix === 'shopee') {
    recalcShopee();
    updatePvMissingAlert('shopee');
    return;
  }

  if (prefix === 'magalu') {
    recalcMagalu();
    updatePvMissingAlert('magalu');
    return;
  }

  recalcDefaultMarketplace(prefix);
}

function recalcAll() {
  for (const prefix of MARKETPLACES) {
    recalc(prefix);
  }
}

function syncSharedValue(field, value, options = {}) {
  const force = Boolean(options.force);

  for (const prefix of MARKETPLACES) {
    if (field === 'margem_lucro' && !isMargemLucroLinked && !force) continue;
    const target = byId(`${field}_${prefix}`);
    if (target) target.value = value;
  }
}

function isNumericField(field, prefix) {
  return PERCENT_FIELDS.includes(field)
    || field === 'custo'
    || field === 'embalagem'
    || field === 'taxa_fixa'
    || (prefix === 'magalu' && field === 'frete_base')
    || (prefix === 'ml' && field === 'custos_adic')
    || (prefix === 'ml' && field === 'impostos');
}

function formatFieldOnBlur(element, field, prefix) {
  const value = parseDecimal(element.value);

  if (PERCENT_FIELDS.includes(field) || (prefix === 'ml' && field === 'impostos')) {
    element.value = value.toLocaleString('pt-BR', { maximumFractionDigits: 2 });
    return;
  }

  if (field === 'custo' || field === 'embalagem' || field === 'taxa_fixa' || (prefix === 'ml' && field === 'custos_adic') || (prefix === 'magalu' && field === 'frete_base')) {
    element.value = fmtBRL.format(value);
    return;
  }

  element.value = value.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function setMargemLucroFieldsReadonly(readonly) {
  for (const prefix of MARKETPLACES) {
    const input = byId(`margem_lucro_${prefix}`);
    if (input) input.readOnly = readonly;
  }
}

function updateMargemLucroToggleButton(linked) {
  const button = byId('margem_lucro_link_toggle');
  if (!button) return;

  button.classList.toggle('is-linked', linked);
  button.setAttribute('aria-pressed', linked ? 'true' : 'false');

  const label = linked
    ? 'Sincronização de margem ativada'
    : 'Sincronização de margem desativada';
  button.title = label;
  button.setAttribute('aria-label', label);
  button.innerHTML = linked
    ? '<i class="fa-solid fa-link" aria-hidden="true"></i>'
    : '<i class="fa-solid fa-link-slash" aria-hidden="true"></i>';
}

function setMargemLucroLinkState(linked, shouldRecalc = true) {
  isMargemLucroLinked = Boolean(linked);
  setMargemLucroFieldsReadonly(isMargemLucroLinked);
  const sharedInput = byId('shared_margem_lucro');
  if (sharedInput) sharedInput.readOnly = !isMargemLucroLinked;
  updateMargemLucroToggleButton(isMargemLucroLinked);

  if (isMargemLucroLinked) {
    const sharedMargemLucro = byId('shared_margem_lucro');
    syncSharedValue('margem_lucro', sharedMargemLucro ? sharedMargemLucro.value : '', { force: true });
  }

  if (shouldRecalc) {
    recalcAll();
  }
}

function bindMargemLucroLinkToggle() {
  const button = byId('margem_lucro_link_toggle');
  if (!button) return;

  button.addEventListener('click', () => {
    setMargemLucroLinkState(!isMargemLucroLinked, true);
  });
}

function bindSharedFields() {
  for (const field of SHARED_FIELDS) {
    const element = byId(`shared_${field}`);
    if (!element) continue;

    element.addEventListener('input', () => {
      const clean = sanitizeNumberString(element.value, 2);
      if (element.value !== clean) element.value = clean;
      syncSharedValue(field, element.value);
      recalcAll();
    });

    element.addEventListener('blur', () => {
      const value = parseDecimal(element.value);
      element.value = PERCENT_FIELDS.includes(field)
        ? value.toLocaleString('pt-BR', { maximumFractionDigits: 2 })
        : fmtBRL.format(value);
      syncSharedValue(field, element.value);
      recalcAll();
    });
  }
}

function applyCostToMarketplaces(value) {
  const formatted = fmtBRL.format(value);
  const sharedCost = byId('shared_custo');
  if (sharedCost) sharedCost.value = formatted;
  syncSharedValue('custo', formatted);
  recalcAll();
}

function syncInitialSharedValues() {
  for (const field of SHARED_FIELDS) {
    const shared = byId(`shared_${field}`);
    if (!shared) continue;
    syncSharedValue(field, shared.value, { force: true });
  }
}

function resetNonFixedValuesOnReload() {
  for (const prefix of MARKETPLACES) {
    localStorage.removeItem(`calc_${prefix}_v1`);
  }

  const skuInput = byId('tiny_sku');
  const nomeInput = byId('tiny_nome');
  const skuMsg = byId('sku_msg');
  if (skuInput) skuInput.value = '';
  if (nomeInput) nomeInput.value = '';
  if (skuMsg) skuMsg.textContent = '';

  for (const prefix of MARKETPLACES) {
    clearMarketplaceFields(prefix);
    resetMarketplaceOutputs(prefix);
  }

  const sharedSpikeDay = byId('shared_spike_day');
  if (sharedSpikeDay) sharedSpikeDay.value = '2,5';

  setValue('spike_day_shopee', '2,5');
  setValue('sla_envio_magalu', '0.5');
  setValue('ads_ml', formatNumber(ML_ADS_TAXA * 100, 0));

  syncInitialSharedValues();

  // Com vínculo desligado por padrão, cada marketplace pode iniciar com margem própria.
  setValue('margem_lucro_shopee', '15');
  setValue('margem_lucro_magalu', '20');
}

function formatDimensionValue(value) {
  const parsed = parseTinyNumericValue(value);
  if (!parsed) return '';
  return parsed.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function parseTinyNumericValue(value) {
  if (value === null || value === undefined || value === '') return 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;

  const raw = String(value).trim();
  if (!raw) return 0;

  if (/^-?\d+(\.\d+)?$/.test(raw)) {
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  // Suporte para eventual string decimal com vírgula.
  if (/^-?\d+(,\d+)?$/.test(raw)) {
    const parsed = Number(raw.replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : 0;
  }

  return parseDecimal(raw);
}

function applyMagaluPackageDataFromTiny(data) {
  setValue('peso_real_magalu', formatDimensionValue(data?.peso_bruto));
  setValue('altura_magalu', formatDimensionValue(data?.alturaEmbalagem));
  setValue('largura_magalu', formatDimensionValue(data?.larguraEmbalagem));
  setValue('comprimento_magalu', formatDimensionValue(data?.comprimentoEmbalagem));
}

function debounce(fn, wait) {
  let timeoutId = null;
  return (...args) => {
    clearTimeout(timeoutId);
    timeoutId = setTimeout(() => fn(...args), wait);
  };
}

function createSuggestionController({ skuInput, nomeInput, onSelect }) {
  let suggestBox = null;
  let suggestions = [];
  let selectedIndex = -1;
  let focusedInput = skuInput || nomeInput || null;

  function createBox() {
    if (suggestBox) return suggestBox;

    suggestBox = document.createElement('div');
    suggestBox.className = 'sku-suggestions';
    suggestBox.style.position = 'absolute';
    suggestBox.style.zIndex = 9999;
    document.body.appendChild(suggestBox);
    return suggestBox;
  }

  function positionBox() {
    if (!focusedInput || !suggestBox) return;

    const rect = focusedInput.getBoundingClientRect();
    suggestBox.style.left = `${window.scrollX + rect.left}px`;
    suggestBox.style.top = `${window.scrollY + rect.bottom + 6}px`;
    suggestBox.style.width = `${rect.width}px`;
  }

  function clear() {
    suggestions = [];
    selectedIndex = -1;

    if (!suggestBox) return;
    suggestBox.innerHTML = '';
    suggestBox.remove();
    suggestBox = null;
  }

  function highlight(index) {
    if (!suggestBox) return;

    const items = Array.from(suggestBox.children);
    items.forEach((item, itemIndex) => {
      item.style.background = itemIndex === index ? '#efefef' : '#fff';
    });
    selectedIndex = index;
  }

  function selectItem(item) {
    if (skuInput) skuInput.value = item.sku || '';
    if (nomeInput) nomeInput.value = item.nome || '';
    clear();
    onSelect(item.sku);
  }

  function render(items) {
    createBox();
    positionBox();
    suggestions = items || [];
    suggestBox.innerHTML = '';

    if (!suggestions.length) return;

    suggestions.forEach((item) => {
      const option = document.createElement('div');
      option.style.padding = '6px 8px';
      option.style.cursor = 'pointer';
      option.innerHTML = `<strong>${item.sku || ''}</strong> <span class="muted">${item.nome || ''}</span>`;
      option.addEventListener('click', () => selectItem(item));
      suggestBox.appendChild(option);
    });
  }

  const search = debounce(async () => {
    const source = focusedInput || skuInput || nomeInput;
    if (!source) return;

    const query = source.value.trim();
    if (query.length < 2) {
      clear();
      return;
    }

    try {
      const field = focusedInput === skuInput ? 'sku' : 'nome';
      const response = await fetch(`/search?q=${encodeURIComponent(query)}&field=${encodeURIComponent(field)}`);
      if (!response.ok) {
        clear();
        return;
      }

      const items = await response.json();
      render(items.slice(0, 10));
    } catch {
      clear();
    }
  }, 250);

  function bindInput(input) {
    input.addEventListener('focus', () => {
      focusedInput = input;
    });

    input.addEventListener('input', () => {
      focusedInput = input;
      search();
    });

    input.addEventListener('keydown', (event) => {
      if (!suggestBox) return;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        highlight(Math.min(suggestions.length - 1, selectedIndex + 1));
        return;
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault();
        highlight(Math.max(0, selectedIndex - 1));
        return;
      }

      if (event.key === 'Enter' && selectedIndex >= 0 && suggestions[selectedIndex]) {
        event.preventDefault();
        selectItem(suggestions[selectedIndex]);
        return;
      }

      if (event.key === 'Escape') clear();
    });
  }

  [skuInput, nomeInput].filter(Boolean).forEach(bindInput);
  window.addEventListener('resize', positionBox);
  document.addEventListener('click', (event) => {
    if (event.target === skuInput || event.target === nomeInput) return;
    if (event.target.closest('.sku-suggestions')) return;
    clear();
  });
}

function bindSkuLookup() {
  const skuInput = byId('tiny_sku');
  const nomeInput = byId('tiny_nome');
  const button = byId('buscar_sku_btn');
  const message = byId('sku_msg');

  async function buscarPorSku(skuArg) {
    const currentSku = (skuArg || skuInput?.value.trim() || '').trim();

    if (!currentSku) {
      const query = nomeInput?.value.trim();
      if (!query) {
        if (message) message.textContent = 'Informe SKU ou nome.';
        return;
      }

      try {
        if (button) button.disabled = true;
        if (message) message.textContent = 'Pesquisando por nome...';

        const response = await fetch(`/search?q=${encodeURIComponent(query)}`);
        if (!response.ok) {
          if (message) message.textContent = 'Erro na pesquisa por nome.';
          return;
        }

        const items = await response.json();
        if (!items || items.length === 0) {
          if (message) message.textContent = 'Nome não encontrado.';
          return;
        }

        const first = items[0];
        if (skuInput) skuInput.value = first.sku || '';
        if (nomeInput) nomeInput.value = first.nome || '';
        await buscarPorSku(first.sku);
      } catch {
        if (message) message.textContent = 'Erro de rede.';
      } finally {
        if (button) button.disabled = false;
      }
      return;
    }

    try {
      if (button) button.disabled = true;
      if (message) message.textContent = 'Pesquisando...';

      const response = await fetch(`/preco-custo/${encodeURIComponent(currentSku)}`);
      if (!response.ok) {
        if (message) {
          message.textContent = response.status === 404 ? 'SKU não encontrado.' : 'Erro ao buscar SKU.';
        }
        return;
      }

      const data = await response.json();
      console.log(data);
      if (skuInput && data.sku) skuInput.value = String(data.sku);
      if (nomeInput && data.nome) nomeInput.value = data.nome;

      const magaluCategory = inferMagaluCategoryFromTiny(data.categoria);
      applyMagaluCategorySelection(magaluCategory);
      applyMagaluPackageDataFromTiny(data);

      applyCostToMarketplaces(data.preco_custo);

      if (message) {
        message.textContent = `Preço preenchido. Nome: ${data.nome || '—'}`;
      }
    } catch {
      if (message) message.textContent = 'Erro de rede.';
    } finally {
      if (button) button.disabled = false;
    }
  }

  if (button) button.addEventListener('click', () => buscarPorSku());
  if (skuInput) {
    skuInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      buscarPorSku();
    });
  }
  if (nomeInput) {
    nomeInput.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      buscarPorSku();
    });
  }

  if (skuInput || nomeInput) {
    createSuggestionController({ skuInput, nomeInput, onSelect: buscarPorSku });
  }
}

function resetAll() {
  for (const field of SHARED_FIELDS) {
    const element = byId(`shared_${field}`);
    if (element) element.value = '';
  }

  for (const prefix of MARKETPLACES) {
    clearMarketplaceFields(prefix);
    resetMarketplaceOutputs(prefix);
  }

  recalcAll();
}

function copyMarketplaceResult(prefix) {
  if (prefix === 'ml') {
    const pvClassico = byId('pv_ml_classico')?.textContent || '';
    const taxasClassico = byId('total_taxas_ml_classico')?.value || '';
    const liquidoClassico = byId('liquido_ml_classico')?.textContent || '';
    const pvPremium = byId('pv_ml_premium')?.textContent || '';
    const taxasPremium = byId('total_taxas_ml_premium')?.value || '';
    const liquidoPremium = byId('liquido_ml_premium')?.textContent || '';
    return `Mercado Livre\n- Clássico: PV ${pvClassico} | Taxas ${taxasClassico}% | Líquido ${liquidoClassico}\n- Premium: PV ${pvPremium} | Taxas ${taxasPremium}% | Líquido ${liquidoPremium}`;
  }

  const pv = byId(`pv_${prefix}`)?.textContent || '';
  const pvSemRS = pv.replace(/R\$\s?/g, '').trim();
  const nome = byId('tiny_nome')?.value || 'Produto';
  const sku = byId('tiny_sku')?.value || '—';
  return `${nome};${sku};${pvSemRS}`;
}

function extractPvNumericValue(rawValue) {
  return String(rawValue || '')
    .replace(/R\$\s?/g, '')
    .replace(/\s+/g, '')
    .trim();
}

let copyToastTimer = null;

function bindCopyPvValueButtons() {
  const buttons = Array.from(document.querySelectorAll('.copy-pv-icon-btn'));

  function showCopyToast(text) {
    let toast = byId('copy_toast_global');
    if (!toast) {
      toast = document.createElement('div');
      toast.className = 'copy-toast';
      toast.id = 'copy_toast_global';
      document.body.appendChild(toast);
    }

    toast.textContent = text;

    // Reinicia a animacao de entrada a cada exibicao.
    toast.style.animation = 'none';
    toast.offsetHeight;
    toast.style.animation = '';
    toast.style.opacity = '1';

    if (copyToastTimer) {
      clearTimeout(copyToastTimer);
    }

    copyToastTimer = setTimeout(() => {
      toast.style.animation = 'none';
      toast.style.opacity = '0';
    }, 1200);
  }

  buttons.forEach((button) => {
    button.addEventListener('click', async () => {
      const targetId = button.dataset.pvTarget;
      // add click efect
        button.classList.add('clicked');
        setTimeout(() => {
          button.classList.remove('clicked');
        }, 100);

      if (!targetId) return;

      const pvText = byId(targetId)?.textContent || '';
      const valueOnly = extractPvNumericValue(pvText);
      if (!valueOnly || valueOnly === '—') {
        showCopyToast('Sem valor para copiar');
        return;
      }

      showCopyToast('Copiando...');

      try {
        await navigator.clipboard.writeText(valueOnly);
        showCopyToast('Copiado!');
      } catch {
        showCopyToast('Falha ao copiar');
      }
    });
  });
}

function bindMarketplaceFields(prefix) {
  loadState(prefix);

  for (const field of getMarketplaceFields(prefix)) {
    const element = byId(`${field}_${prefix}`);
    if (!element) continue;

    if (element.tagName !== 'SELECT') {
      element.addEventListener('keypress', (event) => {
        if (event.key?.length === 1 && !/[0-9.,]/.test(event.key)) {
          event.preventDefault();
        }
      });
    }

    element.addEventListener('input', () => {
      if (element.tagName !== 'SELECT' && isNumericField(field, prefix)) {
        const clean = sanitizeNumberString(element.value, 2);
        if (element.value !== clean) element.value = clean;
      }
      recalc(prefix);
    });

    element.addEventListener('blur', () => {
      if (element.tagName === 'SELECT') return;
      formatFieldOnBlur(element, field, prefix);
    });

    if (element.tagName === 'SELECT') {
      element.addEventListener('change', () => {
        recalc(prefix);
      });
    }
  }

  const resetButton = byId(`resetBtn_${prefix}`);
  if (resetButton) {
    resetButton.addEventListener('click', () => {
      clearMarketplaceFields(prefix);
      resetMarketplaceOutputs(prefix);
      recalc(prefix);
    });
  }

  const copyButton = byId(`copyBtn_${prefix}`);
  if (copyButton) {
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(copyMarketplaceResult(prefix));
      } catch {
      }
    });
  }

  if (prefix === 'magalu') {
    const categoriaEl = byId('categoria_magalu');
    const comissaoEl = byId('comissao_magalu');
    const descontoEl = byId('subsidio_magalu');

    if (comissaoEl) comissaoEl.readOnly = true;
    if (descontoEl) descontoEl.readOnly = true;

    if (categoriaEl) {
      categoriaEl.addEventListener('change', () => {
        applyMagaluCategorySelection(categoriaEl.value);
        recalc('magalu');
      });
      applyMagaluCategorySelection(categoriaEl.value);
    }
  }

  recalc(prefix);
}

function buildShopeeSimHtml(data) {
  if (!data) return '<p>Sem dados de simulação.</p>';

  const {
    pv,
    custo,
    margemLucro,
    pDas,
    pDesc,
    pSpike,
    lower,
    higher
  } = data;
  let html = `<p class="muted">PV atual: ${fmtBRL.format(pv)} - Custo: ${fmtBRL.format(custo)}</p>`;

  html += '<h3>Tabela de Faixas</h3>';
  html += '<table><thead><tr><th>PV Estimado</th><th>Comissão %</th><th>TF (R$)</th></tr></thead><tbody>';
  for (const bracket of SHOPEE_BRACKETS) {
    let rangeLabel;
    if (bracket.max === Infinity) rangeLabel = `maior ${bracket.min}`;
    else if (!bracket.min || bracket.min === 0) rangeLabel = `até ${Number((bracket.max - 0.01).toFixed(2))}`;
    else rangeLabel = `${bracket.min} até ${Number((bracket.max - 0.01).toFixed(2))}`;

    html += `<tr><td>${rangeLabel}</td><td>${formatNumber(bracket.com * 100, 2)}%</td><td>${fmtBRL.format(bracket.tf)}</td></tr>`;
  }
  html += '</tbody></table>';

  html += '<h3>Simulação</h3>';
  html += '<table><thead><tr><th>Teste PV</th><th>Faixa</th><th>Comissão</th><th>Taxa fixa</th><th>Lucro (R$)</th><th>Margem (%)</th></tr></thead><tbody>';

  function simulateFor(pvTest, bracket) {
    const vCom = pvTest * bracket.com;
    const vMargem = pvTest * margemLucro;
    const vDas = pvTest * pDas;
    const vDesc = pvTest * pDesc;
    const vSpike = pvTest * pSpike;
    const total = vCom + vMargem + vDas + vDesc + vSpike + bracket.tf;
    const lucroSim = pvTest - custo - total;
    const margemSim = pvTest > 0 ? lucroSim / pvTest : 0;
    return { lucroSim, margemSim, com: bracket.com, tf: bracket.tf };
  }

  function formatRange(bracket) {
    if (!bracket) return '';
    if (bracket.max === Infinity) return `>= ${bracket.min}`;
    if (!bracket.min || bracket.min === 0) return `até ${Number((bracket.max - 0.01).toFixed(2))}`;
    return `${bracket.min} até ${Number((bracket.max - 0.01).toFixed(2))}`;
  }

  if (lower) {
    const pvLower = lower.max === Infinity ? lower.min : Math.max(0, Number((lower.max - 0.01).toFixed(2)));
    const result = simulateFor(pvLower, lower);
    html += `<tr><td>${fmtBRL.format(pvLower)}</td><td>${formatRange(lower)}</td><td>${formatNumber(result.com * 100, 2)}%</td><td>${fmtBRL.format(result.tf)}</td><td>${fmtBRL.format(result.lucroSim)}</td><td>${formatNumber(result.margemSim * 100, 2)}%</td></tr>`;
  }

  const faixaAtual = getShopeeBracketForPrice(pv);
  const atual = simulateFor(pv, { com: faixaAtual.comissao, tf: faixaAtual.taxa_fixa });
  html += `<tr><td>${fmtBRL.format(pv)}</td><td>${faixaAtual.faixa}</td><td>${formatNumber(atual.com * 100, 2)}%</td><td>${fmtBRL.format(atual.tf)}</td><td>${fmtBRL.format(atual.lucroSim)}</td><td>${formatNumber(atual.margemSim * 100, 2)}%</td></tr>`;

  if (higher) {
    const pvHigher = Number((higher.min || 0).toFixed(2));
    const result = simulateFor(pvHigher, higher);
    html += `<tr><td>${fmtBRL.format(pvHigher)}</td><td>${formatRange(higher)}</td><td>${formatNumber(result.com * 100, 2)}%</td><td>${fmtBRL.format(result.tf)}</td><td>${fmtBRL.format(result.lucroSim)}</td><td>${formatNumber(result.margemSim * 100, 2)}%</td></tr>`;
  }

  html += '</tbody></table>';
  return html;
}

let shopeeModalCloseTimer = null;

function showShopeeSimModal() {
  const modal = byId('modal_sim');
  const body = byId('modal_body');
  if (!modal || !body) return;

  if (shopeeModalCloseTimer) {
    clearTimeout(shopeeModalCloseTimer);
    shopeeModalCloseTimer = null;
  }

  body.innerHTML = buildShopeeSimHtml(window.lastShopeeSim || null);
  modal.classList.remove('modal-closing');
  modal.classList.remove('hidden');
  modal.setAttribute('aria-hidden', 'false');
}

function hideShopeeSimModal() {
  const modal = byId('modal_sim');
  if (!modal) return;

  if (modal.classList.contains('hidden') || modal.classList.contains('modal-closing')) return;

  const content = modal.querySelector('.modal-content');
  const finalizeClose = () => {
    if (shopeeModalCloseTimer) {
      clearTimeout(shopeeModalCloseTimer);
      shopeeModalCloseTimer = null;
    }
    modal.classList.add('hidden');
    modal.classList.remove('modal-closing');
    modal.setAttribute('aria-hidden', 'true');
  };

  modal.classList.add('modal-closing');

  if (content) {
    content.addEventListener('animationend', finalizeClose, { once: true });
  }

  shopeeModalCloseTimer = setTimeout(finalizeClose, 260);
}

function bindShopeeModal() {
  document.addEventListener('click', (event) => {
    const simButton = byId('simular_shopee_btn');
    const closeButton = byId('modal_close');
    const modal = byId('modal_sim');
    const overlay = modal?.querySelector('.modal-overlay');

    if (simButton && event.target === simButton) {
      showShopeeSimModal();
      return;
    }

    if (closeButton && event.target === closeButton) {
      hideShopeeSimModal();
      return;
    }

    if (overlay && event.target === overlay) {
      hideShopeeSimModal();
    }
  });
}

function bindButtonHoldAnimation() {
  const HOLD_CLASS = 'btn-hold-active';

  function activate(button) {
    if (!button) return;
    button.classList.add(HOLD_CLASS);
  }

  function deactivate(button) {
    if (!button) return;
    button.classList.remove(HOLD_CLASS);
  }

  document.addEventListener('pointerdown', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    activate(button);
  });

  document.addEventListener('pointerup', () => {
    document.querySelectorAll(`button.${HOLD_CLASS}`).forEach((button) => {
      deactivate(button);
    });
  });

  document.addEventListener('pointercancel', () => {
    document.querySelectorAll(`button.${HOLD_CLASS}`).forEach((button) => {
      deactivate(button);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const button = event.target.closest('button');
    if (!button) return;
    activate(button);
  });

  document.addEventListener('keyup', (event) => {
    if (event.key !== ' ' && event.key !== 'Enter') return;
    const button = event.target.closest('button');
    if (!button) return;
    deactivate(button);
  });

  document.addEventListener('focusout', (event) => {
    const button = event.target.closest('button');
    if (!button) return;
    deactivate(button);
  });
}

function bindMarketCardExpandToggle() {
  const formsContainer = document.querySelector('.market-flex.market-forms');
  if (!formsContainer) return;

  const cards = Array.from(formsContainer.querySelectorAll('.market-card'));
  const buttons = Array.from(formsContainer.querySelectorAll('.toggle-market-card-btn'));
  const ANIM_DURATION_MS = 230;

  function clearAnimClasses(card) {
    card.classList.remove('is-expanding');
    card.classList.remove('is-collapsing');
  }

  function animateExpand(card) {
    clearAnimClasses(card);
    card.classList.add('is-expanding');
    setTimeout(() => card.classList.remove('is-expanding'), ANIM_DURATION_MS);
  }

  function animateCollapse(card) {
    clearAnimClasses(card);
    card.classList.add('is-collapsing');
    setTimeout(() => card.classList.remove('is-collapsing'), ANIM_DURATION_MS);
  }

  function resetButtons() {
    buttons.forEach((button) => {
      button.textContent = 'Expandir';
      button.setAttribute('aria-pressed', 'false');
    });
  }

  function collapseAll(withAnimation = false) {
    cards.forEach((card) => {
      if (card.classList.contains('is-expanded') && withAnimation) {
        animateCollapse(card);
      }
      card.classList.remove('is-expanded');
    });
    formsContainer.classList.remove('expanded-mode');
    resetButtons();
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const card = button.closest('.market-card');
      if (!card) return;

      const alreadyExpanded = card.classList.contains('is-expanded');
      collapseAll(true);

      if (alreadyExpanded) return;

      card.classList.add('is-expanded');
      animateExpand(card);
      formsContainer.classList.add('expanded-mode');
      button.textContent = 'Recolher';
      button.setAttribute('aria-pressed', 'true');
    });
  });
}

function init() {
  const modal = byId('modal_sim');
  if (modal && modal.parentElement !== document.body) {
    document.body.appendChild(modal);
  }

  initPvMissingAlerts();
  resetNonFixedValuesOnReload();
  setMargemLucroLinkState(false, false);
  bindSharedFields();
  bindMargemLucroLinkToggle();
  bindSkuLookup();
  bindCopyPvValueButtons();
  bindShopeeModal();
  bindButtonHoldAnimation();
  bindMarketCardExpandToggle();

  const resetAllButton = byId('resetBtn_all');
  if (resetAllButton) {
    // confirmacao de reset
    resetAllButton.addEventListener('click', () => {
      if (confirm('Tem certeza que deseja resetar todos os campos?')) {
        resetAll();
      }
    });
  } 

  for (const prefix of MARKETPLACES) {
    bindMarketplaceFields(prefix);
  }
}

window.shopeeFaixaParaPV = getShopeeBracketForPrice;
window.addEventListener('DOMContentLoaded', init);