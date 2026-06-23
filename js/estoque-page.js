const filtroSkuInput = document.getElementById('filtro_sku');
const filtroNomeInput = document.getElementById('filtro_nome');
const msgEstoque = document.getElementById('msg_estoque');
const tbody = document.getElementById('estoque_tbody');
const imprimirBtn = document.getElementById('imprimir');
const impressaoTipoSelect = document.getElementById('impressao_tipo');

if (!filtroSkuInput || !filtroNomeInput || !msgEstoque || !tbody || !imprimirBtn || !impressaoTipoSelect) {
  console.warn('estoque-page.js: elementos obrigatorios nao encontrados no DOM.');
}

let produtosOriginais = [];

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatNumber(value) {
  const numeric = Number(value || 0);
  if (!Number.isFinite(numeric)) return '0';

  return numeric.toLocaleString('pt-BR', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 3
  });
}

function setMessage(text, type) {
  if (!msgEstoque) return;
  msgEstoque.textContent = text;
  msgEstoque.classList.remove('danger', 'info');
  msgEstoque.classList.add(type === 'error' ? 'danger' : 'info');
}

function renderRows(items) {
  if (!tbody) return;

  if (!Array.isArray(items) || items.length === 0) {
    tbody.innerHTML = '<tr><td colspan="5" class="muted">Nenhum produto com saldo reservado para os filtros informados.</td></tr>';
    return;
  }

  tbody.innerHTML = items
    .map((item) => {
      const estoqueDisponivel = Number(item.estoqueDisponivel || 0);
      const linhaBaixoEstoque = Number.isFinite(estoqueDisponivel) && estoqueDisponivel < 10;

      return `
        <tr class="${linhaBaixoEstoque ? 'low-stock-row' : ''}">
          <td>${escapeHtml(item.sku || '-')}</td>
          <td>${escapeHtml(item.nome || '-')}</td>
          <td>${escapeHtml(formatNumber(item.estoqueDisponivel))}</td>
          <td>${escapeHtml(formatNumber(item.estoqueReservado))}</td>
          <td>${escapeHtml(formatNumber(item.saldoFisico))}</td>
        </tr>
      `;
    })
    .join('');
}

function getFilteredItems() {
  if (!filtroSkuInput || !filtroNomeInput) return [];

  const skuFiltro = String(filtroSkuInput.value || '').trim().toLowerCase();
  const nomeFiltro = String(filtroNomeInput.value || '').trim().toLowerCase();

  return produtosOriginais.filter((item) => {
    const sku = String(item.sku || '').toLowerCase();
    const nome = String(item.nome || '').toLowerCase();

    const passaSku = !skuFiltro || sku.includes(skuFiltro);
    const passaNome = !nomeFiltro || nome.includes(nomeFiltro);
    return passaSku && passaNome;
  });
}

function applyFilters() {
  const filtrados = getFilteredItems();

  renderRows(filtrados);
  setMessage(`Exibindo ${filtrados.length} de ${produtosOriginais.length} produto(s) com saldo reservado.`, 'info');
}

function parseSortableValue(value) {
  const raw = String(value || '').trim();
  if (!raw) return { isNumber: false, text: '' };

  const normalized = raw.replace(/\./g, '').replace(',', '.');
  const parsed = Number(normalized);
  if (Number.isFinite(parsed)) {
    return { isNumber: true, number: parsed, text: raw };
  }

  return { isNumber: false, text: raw.toLowerCase() };
}

function initTableSorting() {
  if (!tbody) return;

  const table = tbody.closest('table');
  if (!table) return;

  const headers = table.querySelectorAll('thead th');
  if (!headers.length) return;

  const sortDirection = {};

  headers.forEach((header, index) => {
    header.style.cursor = 'pointer';

    header.addEventListener('click', () => {
      const rows = Array.from(tbody.querySelectorAll('tr'));

      if (rows.length === 1 && rows[0].children.length === 1) {
        return;
      }

      sortDirection[index] = !sortDirection[index];
      const ascending = sortDirection[index];

      rows.sort((a, b) => {
        const aCell = a.children[index];
        const bCell = b.children[index];
        if (!aCell || !bCell) return 0;

        const aValue = parseSortableValue(aCell.textContent);
        const bValue = parseSortableValue(bCell.textContent);

        if (aValue.isNumber && bValue.isNumber) {
          return ascending ? aValue.number - bValue.number : bValue.number - aValue.number;
        }

        return ascending
          ? aValue.text.localeCompare(bValue.text, 'pt-BR')
          : bValue.text.localeCompare(aValue.text, 'pt-BR');
      });

      tbody.innerHTML = '';
      rows.forEach((row) => tbody.appendChild(row));

      headers.forEach((h) => {
        h.innerHTML = h.innerHTML.replace(' ▲', ' ').replace(' ▼', ' ');
      });

      header.innerHTML = header.textContent.replace(' ▲', ' ').replace(' ▼', ' ').trim() + (ascending ? ' ▲' : ' ▼');
    });
  });
}

async function carregarProdutosComSaldoReservado() {
  try {
    const response = await fetch(`/api/estoque-reservado`);
    let payload = null;
    try {
      payload = await response.json();
    } catch (jsonError) {
      throw new Error('Resposta invalida do servidor. Tente novamente em instantes.');
    }

    if (!response.ok) {
      throw new Error(payload?.erro || 'Falha ao consultar estoque reservado.');
    }

    produtosOriginais = Array.isArray(payload.produtos) ? payload.produtos : [];
    applyFilters();

    const paginas = Number(payload.paginasProcessadas || 0);
    const observacao = String(payload.observacao || '').trim();
    const mensagemBase = `Consulta concluida. ${produtosOriginais.length} produto(s) com saldo reservado encontrados em ${paginas} pagina(s).`;
    setMessage(observacao ? `${mensagemBase} ${observacao}` : mensagemBase, 'info');
  } catch (error) {
    produtosOriginais = [];
    renderRows([]);
    setMessage(error.message || 'Erro inesperado ao consultar Tiny.', 'error');
  }
}

function imprimirEstoqueReservado() {
  const tipoImpressao = impressaoTipoSelect ? impressaoTipoSelect.value : 'todos';
  const filtrados = getFilteredItems();
  const itensParaImprimir = tipoImpressao === 'baixo'
    ? filtrados.filter((item) => Number(item.estoqueDisponivel || 0) <= 10)
    : filtrados;

  if (!itensParaImprimir.length) {
    alert('Nenhum produto encontrado para o tipo de impressao selecionado.');
    return;
  }

  const printWindow = window.open('', '_blank');
  if (!printWindow) {
    alert('Falha ao abrir a janela de impressão. Verifique se o bloqueador de pop-ups está ativado.');
    return;
  }

  const linhasHtml = itensParaImprimir.map((item) => {
    const estoqueDisponivel = Number(item.estoqueDisponivel || 0);
    const lowStockClass = Number.isFinite(estoqueDisponivel) && estoqueDisponivel < 10 ? 'low-stock-row' : '';
    return `
      <tr class="${lowStockClass}">
        <td>${escapeHtml(item.sku || '-')}</td>
        <td>${escapeHtml(item.nome || '-')}</td>
        <td>${escapeHtml(formatNumber(item.estoqueDisponivel))}</td>
        <td>${escapeHtml(formatNumber(item.estoqueReservado))}</td>
        <td>${escapeHtml(formatNumber(item.saldoFisico))}</td>
      </tr>
    `;
  }).join('');

  const tituloRelatorio = tipoImpressao === 'baixo'
    ? 'Produtos com Saldo Reservado (Estoque Disponivel <= 10)'
    : 'Produtos com Saldo Reservado';

  const tableHtml = `
    <html>
      <head>
        <title>${tituloRelatorio}</title>
        <style>
          body { font-family: Arial, sans-serif; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ccc; padding: 8px; text-align: left; }
          th { background-color: #f2f2f2; }
          .low-stock-row { background-color: #ffe6e6; }
        </style>
      </head>
      <body>
        <h2>${tituloRelatorio}</h2>
        <table>
          <thead>
            <tr>
              <th>SKU</th>
              <th>Nome</th>
              <th>Estoque Disponível</th>
              <th>Estoque Reservado</th>
              <th>Saldo Físico</th>
            </tr>
          </thead>
          <tbody>
            ${linhasHtml}
          </tbody>
        </table>
      </body>
    </html>
  `;

  printWindow.document.open();
  printWindow.document.write(tableHtml);
  printWindow.document.close();
  printWindow.focus();
  printWindow.print();
  printWindow.close();
}

if (filtroSkuInput && filtroNomeInput) {
  filtroSkuInput.addEventListener('input', applyFilters);
  filtroNomeInput.addEventListener('input', applyFilters);
}

function initEstoquePage() {
  initTableSorting();
  carregarProdutosComSaldoReservado();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initEstoquePage);
} else {
  initEstoquePage();
}

if (imprimirBtn) {
  imprimirBtn.addEventListener('click', imprimirEstoqueReservado);
}