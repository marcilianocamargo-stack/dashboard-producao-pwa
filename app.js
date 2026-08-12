/* Dashboard Prime — Produção Diária
 * Tudo roda no navegador: leitura de PDF/XLSX, cálculo dos indicadores e
 * geração do Excel de saída. Nenhum arquivo sai do dispositivo do usuário.
 *
 * Método (mesmo do dashboard geral):
 *   velocidade média (m/min) = metros lineares (comprimento × chapas) / (420 min × nº de turnos carregados)
 *   largura média (mm) = média ponderada por chapas produzidas
 *   peso (kg) = (largura_m × comprimento_m × chapas) × gramatura do papel (kg/m²) — tabela configurável
 * Linhas com MEDIDA fisicamente implausível (comprimento >5m ou ≤0; largura >1650mm ou ≤50mm)
 * são excluídas das médias e do peso, mas continuam na tabela detalhada.
 */

// ------------------------------------------------------------------ CONFIG
const TURNO_MIN_EFETIVOS = 420;

// Gramatura padrão (kg de peso por m² de chapa) — vem da Tabela de
// Especificações Técnicas dos Produtos da Prime (Companhia Paranaense de
// Papel Ondulado), gr/m² ÷ 1000. O sufixo do código indica a onda:
// B = Onda B, C = Onda C, D = Parede Dupla (Onda B/C).
// "PW80B" e "P30B" não constam na tabela oficial — mantido valor
// aproximado; revise em "Configurar gramatura" se souber o valor correto.
const GRAMATURA_PADRAO = {
  "P70D": 0.632, "P55B": 0.398, "P55D": 0.568, "P50D": 0.538,
  "P80B": 0.514, "PW80B": 0.514, "P70B": 0.458, "P60C": 0.440,
  "P60B": 0.428, "P45B": 0.365, "P50C": 0.399, "PW50B": 0.388,
  "P50B": 0.388, "PW40B": 0.365, "P40C": 0.365, "P35B": 0.345,
  "P40B": 0.355, "P30B": 0.365, "P25B": 0.315, "P25C": 0.324,
  "PK45C": 0.389,
};

const CANONICALIZACAO_CLIENTES = {
  "HARMONY": "HARMONY EMBALAGENS",
  "HARMONY EMBALAGENS LTDA": "HARMONY EMBALAGENS",
  "HARMONY EMBALAGEN": "HARMONY EMBALAGENS", // PDF corta o nome (largura de coluna)
  "ABAPEL": "ABAPEL COMERCIO DE EMBALAGENS LTDA",
  "RM": "RM EMBALAGENS DE PAPELÃO LTDA",
  "RM EMBALAGENS": "RM EMBALAGENS DE PAPELÃO LTDA",
  "PCBOX": "PCBOX EMBALAGENS LTDA",
  "TOLECAIXAS": "TOLECAIXAS INDÚSTRIA E COMÉRCIO LTDA",
  "DR EMBALAGEM": "DR EMBALAGENS",
};

const PAPEL_RE = /P\s?W?\s?\d{2,3}\s?[A-Z]\s*$/i;
const TITULO_RE = /(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4}).{0,25}?TURNO[\s:\-]+([A-ZÀ-Ü]+)/i;
const DATA_RE = /(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})/;

// -------------------------------------------------------------- ESTADO ----
const state = {
  gramatura: loadGramatura(),
  arquivos: { dia: null, noite: null }, // cada um: {ok, nomeArquivo, rows, warnings, dataTexto}
  dashboards: {}, // { dia, noite, total } — um dashboard completo por visão
  activeView: null, // "dia" | "noite" | "total"
};

function loadGramatura() {
  try {
    const saved = localStorage.getItem("prime_gramatura_v1");
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore */ }
  return { ...GRAMATURA_PADRAO };
}
function saveGramatura() {
  localStorage.setItem("prime_gramatura_v1", JSON.stringify(state.gramatura));
}

// ------------------------------------------------------------- UTILS ------
function toNumber(x) {
  if (x === null || x === undefined || x === "") return null;
  if (typeof x === "number") return x;
  let s = String(x).trim().replace(/%/g, "");
  if (!s) return null;
  let v = parseFloat(s.replace(/\./g, "").replace(",", "."));
  if (!isNaN(v)) return v;
  v = parseFloat(s.replace(",", "."));
  return isNaN(v) ? null : v;
}

function parseMedida(s) {
  if (!s) return [null, null];
  const str = String(s).replace(/\s+/g, "");
  const m = str.match(/^([\d,.]+)X([\d,.]+)/i);
  if (!m) return [null, null];
  const largura = parseFloat(m[1].replace(",", "."));
  const comprimento = parseFloat(m[2].replace(",", "."));
  return [isNaN(largura) ? null : largura, isNaN(comprimento) ? null : comprimento];
}

function reconciliarClientePapel(clienteRaw, papelRaw) {
  let combinado = `${clienteRaw || ""} ${papelRaw || ""}`.trim().replace(/\s+/g, " ");
  let papel = (papelRaw || "").trim();
  let cliente = (clienteRaw || "").trim();
  const m = combinado.match(PAPEL_RE);
  if (m) {
    papel = m[0].replace(/\s+/g, "").toUpperCase();
    cliente = combinado.slice(0, m.index).trim();
  }
  cliente = cliente.replace(/^\d+\s+/, "").trim();
  const canon = CANONICALIZACAO_CLIENTES[cliente.toUpperCase()];
  if (canon) cliente = canon;
  if (!cliente) cliente = "(não identificado)";
  return { cliente, papel: papel.toUpperCase() };
}

function extrairDataTexto(fullText) {
  if (!fullText) return null;
  let m = fullText.match(TITULO_RE);
  if (!m) m = fullText.match(DATA_RE);
  if (!m) return null;
  const digits = m[1].replace(/\D/g, "");
  if (digits.length !== 8) return null;
  const dd = digits.slice(0, 2), mm = digits.slice(2, 4), yyyy = digits.slice(4, 8);
  return `${yyyy}-${mm}-${dd}`;
}

function isIdToken(tok) {
  return /^\d{4,7}$/.test((tok || "").trim());
}

// --------------------------------------------------------- XLSX PARSER ----
function extrairDeXlsx(arrayBuffer) {
  const wb = XLSX.read(arrayBuffer, { type: "array" });
  let rowsFound = [], template = null, textoPartes = [];

  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });
    for (const r of rows.slice(0, 6)) {
      textoPartes.push(r.filter((c) => c !== null && c !== undefined).join(" "));
    }
    let localFound = [];
    let localTemplate = null;
    for (let i = 0; i < rows.length; i++) {
      const t = rowMatchesHeader(rows[i]);
      if (t) {
        localTemplate = t;
        for (let k = i + 1; k < rows.length; k++) {
          const row = rows[k];
          if (row && isIdToken(row[0])) {
            localFound.push(cleanRow(row, t.length));
          }
        }
      }
    }
    if (localFound.length) {
      rowsFound = localFound;
      template = localTemplate;
      break; // usa a primeira aba com tabela-resumo, igual ao pipeline em Python
    }
  }
  return { rowsFound, template, texto: textoPartes.join(" ") };
}

const TEMPLATE_COM_OP = ["OP", "OC", "OF", "CLIENTE", "PAPEL", "MEDIDA", "QTDE PEDIDO", "PRODUZIDO", "PALETES", "SALDO", "%"];
const TEMPLATE_SEM_OP = ["OF", "OC", "CLIENTE", "PAPEL", "MEDIDA", "QTDE PEDIDO", "PRODUZIDO", "PALETES", "SALDO", "%"];

function normHeaderCell(x) {
  if (x === null || x === undefined) return "";
  return String(x).replace(/\s+/g, " ").trim().toUpperCase();
}

function rowMatchesHeader(row) {
  if (!row) return null;
  const cells = row.map(normHeaderCell);
  const joined = cells.join(" ");
  if (!(joined.includes("CLIENTE") && joined.includes("MEDIDA") && joined.includes("PRODUZID") && joined.includes("SALDO"))) {
    return null;
  }
  const primeira = cells[0] || "";
  if (primeira === "OP") return TEMPLATE_COM_OP;
  if (primeira === "OF") return TEMPLATE_SEM_OP;
  return null;
}

function cleanRow(row, width) {
  const out = row.slice(0, width);
  while (out.length < width) out.push(null);
  return out;
}

function rowsToObjects(rowsFound, template) {
  if (!rowsFound.length || !template) return [];
  return rowsFound.map((r) => {
    const obj = {};
    template.forEach((h, i) => (obj[h] = r[i]));
    if (!("OP" in obj)) obj.OP = obj.OF;
    return obj;
  });
}

// ---------------------------------------------------------- PDF PARSER ----
async function extrairDePdf(arrayBuffer) {
  pdfjsLib.GlobalWorkerOptions.workerSrc = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
  let allLines = [];
  let textoPartes = [];

  for (let p = 1; p <= pdf.numPages; p++) {
    const page = await pdf.getPage(p);
    const content = await page.getTextContent();
    const items = content.items
      .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
      .filter((it) => it.str && it.str.trim().length > 0);
    textoPartes.push(items.map((i) => i.str).join(" "));

    const lines = [];
    const TOL = 2.5;
    for (const it of items) {
      let line = lines.find((l) => Math.abs(l.y - it.y) <= TOL);
      if (!line) { line = { y: it.y, items: [] }; lines.push(line); }
      line.items.push(it);
    }
    lines.sort((a, b) => b.y - a.y);
    for (const l of lines) l.items.sort((a, b) => a.x - b.x);
    for (const l of lines) {
      allLines.push(l.items.map((i) => i.str).join(" ").replace(/\s+/g, " ").trim());
    }
  }

  const texto = textoPartes.join(" ");

  // Acha a linha de cabeçalho da tabela-RESUMO (não a do log detalhado por
  // palete, que se repete antes de cada OP e não tem a coluna "PRODUZID" —
  // só tem "N CHAPAS"). Guarda o índice pra só ler linhas de dado DEPOIS
  // dela, senão as linhas do log detalhado (mesmo formato OP+MEDIDA) também
  // seriam lidas como se fossem linhas da tabela-resumo.
  let template = null, headerIdx = -1;
  for (let idx = 0; idx < allLines.length; idx++) {
    const line = allLines[idx];
    const upper = line.toUpperCase();
    if (upper.includes("CLIENTE") && upper.includes("MEDIDA") && upper.includes("PRODUZID") && upper.includes("SALDO")) {
      const primeiraPalavra = line.trim().split(/\s+/)[0].toUpperCase();
      if (primeiraPalavra === "OP") { template = TEMPLATE_COM_OP; headerIdx = idx; break; }
      if (primeiraPalavra === "OF") { template = TEMPLATE_SEM_OP; headerIdx = idx; break; }
    }
  }
  if (!template) return { rows: [], warnings: ["Tabela-resumo não encontrada no PDF (título/cabeçalho não reconhecido)."], texto };

  const leadingCount = template[0] === "OP" ? 3 : 2; // nº de colunas de identificação antes de CLIENTE
  const rows = [];
  const warnings = [];
  for (let idx = headerIdx + 1; idx < allLines.length; idx++) {
    const line = allLines[idx];
    const firstTok = line.split(/\s+/)[0];
    if (!isIdToken(firstTok)) continue;

    const medidaMatch = line.match(/([\d.,]+)\s*[xX]\s*([\d.,]+)/);
    if (!medidaMatch) continue; // não é uma linha de dado da tabela-resumo

    const preMedida = line.slice(0, medidaMatch.index).trim();
    const posMedida = line.slice(medidaMatch.index + medidaMatch[0].length).trim();

    const papelMatch = preMedida.toUpperCase().match(/P\s?W?\s?\d{2,3}\s?[A-Z]\b/);
    let clienteBruto, papelBruto;
    if (papelMatch) {
      papelBruto = papelMatch[0];
      clienteBruto = preMedida.slice(0, papelMatch.index);
    } else {
      clienteBruto = preMedida;
      papelBruto = "";
    }
    // remove os tokens iniciais de identificação (OP/OF, OC, [OF]) do início do cliente
    const clienteTokens = clienteBruto.trim().split(/\s+/);
    clienteBruto = clienteTokens.slice(leadingCount - 1).join(" "); // -1 pois o 1º token (OP/OF) já não está aqui

    const { cliente, papel } = reconciliarClientePapel(clienteBruto, papelBruto);

    const largura = parseFloat(medidaMatch[1].replace(",", "."));
    const comprimento = parseFloat(medidaMatch[2].replace(",", "."));

    const numerosDepois = (posMedida.match(/[\d.,]+%?/g) || []).map(toNumber);
    const produzido = numerosDepois.length > 1 ? numerosDepois[1] : null;

    rows.push({
      OP: firstTok,
      CLIENTE: cliente,
      PAPEL: papel,
      MEDIDA: `${medidaMatch[1]}X${medidaMatch[2]}`,
      PRODUZIDO: produzido,
      largura_m_raw: isNaN(largura) ? null : largura,
      comprimento_m_raw: isNaN(comprimento) ? null : comprimento,
    });
  }

  if (!rows.length) {
    warnings.push("Cabeçalho da tabela foi encontrado, mas nenhuma linha de dado foi reconhecida.");
  } else {
    warnings.push("Arquivo é PDF: nomes de cliente podem sair imprecisos (limitação da extração de texto). Velocidade, largura e peso não são afetados.");
  }

  return { rows, warnings, texto };
}

// --------------------------------------------------------- PARSE FILE -----
async function parseFile(file, turnoLabel) {
  const buf = await file.arrayBuffer();
  const ext = file.name.split(".").pop().toLowerCase();
  let objRows = [], warnings = [], texto = "";

  if (ext === "xlsx") {
    const { rowsFound, template, texto: t } = extrairDeXlsx(buf);
    texto = t;
    if (!rowsFound.length || !template) {
      return { ok: false, error: "Tabela-resumo não encontrada neste Excel (verifique se é o relatório de produção do turno)." };
    }
    const objs = rowsToObjects(rowsFound, template);
    objRows = objs.map((o) => normalizarLinha(o));
  } else if (ext === "pdf") {
    const { rows, warnings: w, texto: t } = await extrairDePdf(buf);
    texto = t;
    warnings = w;
    if (!rows.length) {
      return { ok: false, error: "Não consegui extrair a tabela deste PDF. Se for um PDF escaneado (imagem), tente o Excel do mesmo turno." };
    }
    objRows = rows.map((o) => normalizarLinhaPdf(o));
  } else {
    return { ok: false, error: "Formato não suportado — use .pdf ou .xlsx." };
  }

  const dataTexto = extrairDataTexto(texto);
  const nSuspeitas = objRows.filter((r) => r.medida_suspeita).length;
  if (nSuspeitas > 0) {
    warnings.push(`${nSuspeitas} linha(s) com medida fisicamente implausível — excluídas da velocidade/largura/peso, mas mantidas na tabela detalhada.`);
  }
  const semGramatura = new Set(objRows.filter((r) => !(r.PAPEL in state.gramatura)).map((r) => r.PAPEL));
  if (semGramatura.size) {
    warnings.push(`Tipo(s) de papel sem gramatura cadastrada (peso não calculado para essas linhas): ${[...semGramatura].join(", ")}. Adicione em "Configurar gramatura".`);
  }

  return {
    ok: true,
    nomeArquivo: file.name,
    turno: turnoLabel,
    dataTexto,
    rows: objRows,
    warnings,
    nOps: objRows.length,
  };
}

function normalizarLinha(o) {
  const { cliente, papel } = reconciliarClientePapel(o.CLIENTE, o.PAPEL);
  const [larguraM, comprimentoM] = parseMedida(o.MEDIDA);
  const larguraMm = larguraM !== null ? larguraM * 1000 : null;
  const chapas = toNumber(o.PRODUZIDO);
  const suspeita = comprimentoM === null || comprimentoM <= 0 || comprimentoM > 5 ||
                    larguraMm === null || larguraMm <= 50 || larguraMm > 1650;
  return {
    OP: String(o.OP ?? ""),
    CLIENTE: cliente,
    PAPEL: papel,
    largura_mm: larguraMm,
    comprimento_m: comprimentoM,
    produzido_chapas: chapas || 0,
    medida_suspeita: suspeita,
  };
}

function normalizarLinhaPdf(o) {
  const larguraMm = o.largura_m_raw !== null ? o.largura_m_raw * 1000 : null;
  const comprimentoM = o.comprimento_m_raw;
  const chapas = toNumber(o.PRODUZIDO);
  const suspeita = comprimentoM === null || comprimentoM <= 0 || comprimentoM > 5 ||
                    larguraMm === null || larguraMm <= 50 || larguraMm > 1650;
  return {
    OP: String(o.OP ?? ""),
    CLIENTE: o.CLIENTE || "(não identificado)",
    PAPEL: o.PAPEL || "",
    largura_mm: larguraMm,
    comprimento_m: comprimentoM,
    produzido_chapas: chapas || 0,
    medida_suspeita: suspeita,
  };
}

// ------------------------------------------------------- CÁLCULO KPIs -----
function computeDashboard(turnosFiltro) {
  const turnos = (turnosFiltro || ["dia", "noite"]).filter((t) => state.arquivos[t] && state.arquivos[t].ok);
  const nTurnos = turnos.length;
  let allRows = [];
  for (const t of turnos) {
    for (const r of state.arquivos[t].rows) allRows.push({ ...r, turno: t });
  }

  for (const r of allRows) {
    if (!r.medida_suspeita) {
      const gram = state.gramatura[r.PAPEL];
      r.metros_lineares = r.comprimento_m * r.produzido_chapas;
      r.peso_kg = gram != null ? (r.largura_mm / 1000) * r.comprimento_m * r.produzido_chapas * gram : null;
    } else {
      r.metros_lineares = 0;
      r.peso_kg = null;
    }
  }

  const rowsOk = allRows.filter((r) => !r.medida_suspeita);
  const totalMetros = rowsOk.reduce((s, r) => s + (r.metros_lineares || 0), 0);
  const velocidadeMedia = nTurnos > 0 ? totalMetros / (TURNO_MIN_EFETIVOS * nTurnos) : 0;
  const somaChapas = rowsOk.reduce((s, r) => s + (r.produzido_chapas || 0), 0);
  const larguraMedia = somaChapas > 0
    ? rowsOk.reduce((s, r) => s + r.largura_mm * r.produzido_chapas, 0) / somaChapas
    : null;
  const pesoTotal = allRows.reduce((s, r) => s + (r.peso_kg || 0), 0);
  const totalChapas = allRows.reduce((s, r) => s + (r.produzido_chapas || 0), 0);
  const nOpsSuspeitas = allRows.filter((r) => r.medida_suspeita).length;

  // por cliente
  const porCliente = {};
  for (const r of allRows) {
    const k = r.CLIENTE || "(não identificado)";
    if (!porCliente[k]) porCliente[k] = { cliente: k, peso: 0, chapas: 0, registros: 0 };
    porCliente[k].peso += r.peso_kg || 0;
    porCliente[k].chapas += r.produzido_chapas || 0;
    porCliente[k].registros += 1;
  }
  const clientes = Object.values(porCliente).sort((a, b) => b.peso - a.peso);

  // por tipo de papel (ex.: P50D, P25B)
  const porPapel = {};
  for (const r of allRows) {
    const k = r.PAPEL || "(sem papel)";
    if (!porPapel[k]) porPapel[k] = { papel: k, peso: 0, chapas: 0, registros: 0 };
    porPapel[k].peso += r.peso_kg || 0;
    porPapel[k].chapas += r.produzido_chapas || 0;
    porPapel[k].registros += 1;
  }
  const papeis = Object.values(porPapel).sort((a, b) => b.peso - a.peso);

  // por turno (pra comparativo dia x noite)
  const porTurno = {};
  for (const t of turnos) {
    const rs = allRows.filter((r) => r.turno === t && !r.medida_suspeita);
    const metros = rs.reduce((s, r) => s + r.metros_lineares, 0);
    const chapas = rs.reduce((s, r) => s + r.produzido_chapas, 0);
    const peso = allRows.filter((r) => r.turno === t).reduce((s, r) => s + (r.peso_kg || 0), 0);
    porTurno[t] = {
      velocidade: metros / TURNO_MIN_EFETIVOS,
      largura: chapas > 0 ? rs.reduce((s, r) => s + r.largura_mm * r.produzido_chapas, 0) / chapas : null,
      peso, chapas,
    };
  }

  const datas = turnos.map((t) => state.arquivos[t].dataTexto).filter(Boolean);
  const dataRef = datas[0] || null;

  return {
    turnos, nTurnos, allRows, rowsOk,
    velocidadeMedia, larguraMedia, pesoTotal, totalChapas, nOpsSuspeitas,
    clientes, papeis, porTurno, dataRef,
  };
}

function computeAllViews() {
  const carregados = ["dia", "noite"].filter((t) => state.arquivos[t] && state.arquivos[t].ok);
  const views = {};
  if (carregados.includes("dia")) {
    views.dia = computeDashboard(["dia"]);
    views.dia.tituloView = "DASHBOARD DE PRODUÇÃO — TURNO DIA";
  }
  if (carregados.includes("noite")) {
    views.noite = computeDashboard(["noite"]);
    views.noite.tituloView = "DASHBOARD DE PRODUÇÃO — TURNO NOITE";
  }
  if (carregados.length) {
    views.total = computeDashboard(carregados);
    views.total.tituloView = "DASHBOARD DE PRODUÇÃO — DIA + NOITE (TOTAL)";
  }
  return views;
}

// ------------------------------------------------------------ RENDER ------
function fmt(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

let chartClientes, chartTurnos;

function renderDashboard(d) {
  document.getElementById("card-dashboard").classList.remove("hidden");
  document.getElementById("dash-title").textContent = d.tituloView || "DASHBOARD DE PRODUÇÃO";

  const subtitleBits = [];
  if (d.dataRef) subtitleBits.push(`Data: ${d.dataRef.split("-").reverse().join("/")}`);
  subtitleBits.push(`Turnos carregados: ${d.turnos.map((t) => t.toUpperCase()).join(" + ") || "—"}`);
  subtitleBits.push(`${d.allRows.length} OPs (${d.nOpsSuspeitas} com medida suspeita)`);
  document.getElementById("dash-subtitle").textContent = subtitleBits.join("   ·   ");

  const kpis = [
    ["VELOCIDADE MÉDIA", fmt(d.velocidadeMedia, 2), "m/min"],
    ["LARGURA MÉDIA DOS PEDIDOS", fmt(d.larguraMedia, 0), "mm"],
    ["PESO TOTAL PRODUZIDO", fmt(d.pesoTotal, 0), "kg"],
    ["CHAPAS PRODUZIDAS", fmt(d.totalChapas, 0), ""],
  ];
  document.getElementById("kpi-row").innerHTML = kpis.map(([label, val, unit]) => `
    <div class="kpi-box">
      <div class="kpi-label">${label}</div>
      <div class="kpi-value">${val}${unit ? ` <small style="font-size:0.9rem">${unit}</small>` : ""}</div>
    </div>`).join("");

  // gráfico clientes
  const topClientes = d.clientes.slice(0, 8);
  if (chartClientes) chartClientes.destroy();
  chartClientes = new Chart(document.getElementById("chart-clientes"), {
    type: "bar",
    data: {
      labels: topClientes.map((c) => c.cliente),
      datasets: [{ data: topClientes.map((c) => Math.round(c.peso)), backgroundColor: "#2E75B6" }],
    },
    options: {
      indexAxis: "y",
      plugins: { legend: { display: false } },
      scales: { x: { title: { display: true, text: "kg" } } },
    },
  });

  // gráfico dia x noite — só faz sentido quando a visão tem os dois turnos
  const chartCardTurnos = document.getElementById("chart-card-turnos");
  if (d.turnos.length > 1) {
    chartCardTurnos.classList.remove("hidden");
    if (chartTurnos) chartTurnos.destroy();
    chartTurnos = new Chart(document.getElementById("chart-turnos"), {
      type: "bar",
      data: {
        labels: ["Velocidade (m/min)", "Peso (kg) ÷100", "Chapas ÷100"],
        datasets: d.turnos.map((t, i) => ({
          label: t.toUpperCase(),
          backgroundColor: i === 0 ? "#2E75B6" : "#1BAF7A",
          data: [
            d.porTurno[t].velocidade,
            d.porTurno[t].peso / 100,
            d.porTurno[t].chapas / 100,
          ],
        })),
      },
      options: { plugins: { legend: { display: true } } },
    });
  } else {
    chartCardTurnos.classList.add("hidden");
    if (chartTurnos) { chartTurnos.destroy(); chartTurnos = null; }
  }

  // tabela clientes
  const tCli = document.getElementById("tabela-clientes");
  tCli.innerHTML = `<thead><tr><th>Cliente</th><th>Peso (kg)</th><th>Chapas</th><th>Registros</th></tr></thead>
    <tbody>${d.clientes.map((c) => `<tr><td>${c.cliente}</td><td class="num">${fmt(c.peso, 0)}</td><td class="num">${fmt(c.chapas, 0)}</td><td class="num">${c.registros}</td></tr>`).join("")}</tbody>`;

  // tabela tipo de papel
  const tPapel = document.getElementById("tabela-papel");
  tPapel.innerHTML = `<thead><tr><th>Papel</th><th>Peso (kg)</th><th>Chapas</th><th>Registros</th></tr></thead>
    <tbody>${d.papeis.map((p) => `<tr><td>${p.papel}</td><td class="num">${fmt(p.peso, 0)}</td><td class="num">${fmt(p.chapas, 0)}</td><td class="num">${p.registros}</td></tr>`).join("")}</tbody>`;

  // tabela detalhado
  const tDet = document.getElementById("tabela-detalhado");
  tDet.innerHTML = `<thead><tr><th>Turno</th><th>OP</th><th>Cliente</th><th>Papel</th><th>Largura (mm)</th><th>Compr. (m)</th><th>Chapas</th><th>Peso (kg)</th><th>Suspeita</th></tr></thead>
    <tbody>${d.allRows.map((r) => `<tr class="${r.medida_suspeita ? "suspeita" : ""}">
      <td>${r.turno.toUpperCase()}</td><td>${r.OP}</td><td>${r.CLIENTE}</td><td>${r.PAPEL}</td>
      <td class="num">${fmt(r.largura_mm, 0)}</td><td class="num">${fmt(r.comprimento_m, 2)}</td>
      <td class="num">${fmt(r.produzido_chapas, 0)}</td><td class="num">${r.peso_kg != null ? fmt(r.peso_kg, 1) : "—"}</td>
      <td class="${r.medida_suspeita ? "suspeita" : ""}">${r.medida_suspeita ? "SIM" : ""}</td>
    </tr>`).join("")}</tbody>`;

  // notas
  const notas = [];
  for (const t of d.turnos) {
    for (const w of state.arquivos[t].warnings || []) notas.push(`[${t.toUpperCase()}] ${w}`);
  }
  document.getElementById("notes-card").innerHTML = notas.length
    ? `<strong>Notas</strong>${notas.map((n) => `<p>• ${n}</p>`).join("")}`
    : "";

  document.getElementById("card-dashboard").scrollIntoView({ behavior: "smooth" });
}

function turnoCardHtml(titulo, dados, extraClass = "") {
  if (!dados) {
    return `<div class="turno-card ${extraClass}">
      <div class="turno-card-title">${titulo}</div>
      <div class="turno-card-empty">Sem relatório carregado</div>
    </div>`;
  }
  return `<div class="turno-card ${extraClass}">
    <div class="turno-card-title">${titulo}</div>
    <div class="turno-card-metric"><span class="turno-card-val">${fmt(dados.peso, 0)}</span><span class="turno-card-unit">kg</span></div>
    <div class="turno-card-rows">
      <div><span>CHAPAS</span><b>${fmt(dados.chapas, 0)}</b></div>
      <div><span>VELOCIDADE</span><b>${fmt(dados.velocidade, 2)} m/min</b></div>
    </div>
  </div>`;
}

function renderTurnoCards(d) {
  const dadosDia = d.porTurno.dia || null;
  const dadosNoite = d.porTurno.noite || null;
  const dadosTotal = d.turnos.length
    ? { peso: d.pesoTotal, chapas: d.totalChapas, velocidade: d.velocidadeMedia }
    : null;

  document.getElementById("turno-row").innerHTML =
    turnoCardHtml("Produção do dia", dadosDia) +
    turnoCardHtml("Produção da noite", dadosNoite) +
    turnoCardHtml("Total (dia + noite)", dadosTotal, "turno-card-total");
}

function renderViewTabs() {
  const tabs = [
    { key: "dia", label: "Turno Dia" },
    { key: "noite", label: "Turno Noite" },
    { key: "total", label: "Dia + Noite (Total)" },
  ];
  const el = document.getElementById("view-tabs");
  el.innerHTML = tabs.map((t) => {
    const disponivel = !!state.dashboards[t.key];
    const ativo = state.activeView === t.key;
    return `<button type="button" class="view-tab${ativo ? " active" : ""}" data-view="${t.key}" ${disponivel ? "" : "disabled"}>${t.label}</button>`;
  }).join("");
  el.querySelectorAll(".view-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeView = btn.dataset.view;
      renderViewTabs();
      renderDashboard(state.dashboards[state.activeView]);
    });
  });
}

// ------------------------------------------------------------- EXCEL ------
const EXCEL_CORES = {
  AZUL_ESCURO: "FF1F4E78", AZUL_MEDIO: "FF2E75B6", CIANO: "FF9DC3E6",
  CIANO_CLARO: "FFDDEBF7", CINZA: "FFF2F2F2",
};
const VIEW_LABELS = { dia: "Dia", noite: "Noite", total: "Total" };

function headerRow(sheet) {
  sheet.getRow(1).eachCell((c) => {
    c.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
    c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_CORES.AZUL_ESCURO } };
  });
}

// Replica, para uma visão (Dia / Noite / Total), as mesmas informações
// mostradas na tela: KPIs, tabela detalhada por OP (com o tipo de papel),
// resumo por cliente e resumo por tipo de papel.
function gerarAbasDaVisao(wb, label, d) {
  const { AZUL_ESCURO, AZUL_MEDIO, CIANO, CINZA } = EXCEL_CORES;
  const detNome = `Detalhado_${label}`;

  const detSheet = wb.addWorksheet(detNome);
  detSheet.columns = [
    { header: "Turno", key: "turno", width: 10 },
    { header: "OP", key: "OP", width: 10 },
    { header: "Cliente", key: "CLIENTE", width: 34 },
    { header: "Papel", key: "PAPEL", width: 10 },
    { header: "Largura (mm)", key: "largura_mm", width: 13 },
    { header: "Compr. (m)", key: "comprimento_m", width: 12 },
    { header: "Chapas", key: "produzido_chapas", width: 10 },
    { header: "Peso (kg)", key: "peso_kg", width: 12 },
    { header: "Suspeita", key: "susp", width: 10 },
  ];
  headerRow(detSheet);
  d.allRows.forEach((r) => {
    detSheet.addRow({
      turno: r.turno.toUpperCase(), OP: r.OP, CLIENTE: r.CLIENTE, PAPEL: r.PAPEL,
      largura_mm: r.largura_mm, comprimento_m: r.comprimento_m, produzido_chapas: r.produzido_chapas,
      peso_kg: r.peso_kg, susp: r.medida_suspeita ? 1 : 0,
    });
  });
  const lastRow = d.allRows.length + 1;
  detSheet.getColumn("largura_mm").numFmt = "#,##0";
  detSheet.getColumn("comprimento_m").numFmt = "0.00";
  detSheet.getColumn("produzido_chapas").numFmt = "#,##0";
  detSheet.getColumn("peso_kg").numFmt = "#,##0.0";

  const rcNome = `Resumo_Cliente_${label}`;
  const rc = wb.addWorksheet(rcNome);
  rc.columns = [
    { header: "Cliente", key: "c", width: 34 },
    { header: "Peso (kg)", key: "peso", width: 13 },
    { header: "Chapas", key: "chapas", width: 12 },
    { header: "Registros", key: "reg", width: 11 },
  ];
  headerRow(rc);
  d.clientes.forEach((cl, i) => {
    const r = i + 2;
    rc.addRow({
      c: cl.cliente,
      peso: { formula: `SUMIFS(${detNome}!H2:H${lastRow},${detNome}!C2:C${lastRow},A${r})` },
      chapas: { formula: `SUMIFS(${detNome}!G2:G${lastRow},${detNome}!C2:C${lastRow},A${r})` },
      reg: { formula: `COUNTIFS(${detNome}!C2:C${lastRow},A${r})` },
    });
  });
  rc.getColumn("peso").numFmt = "#,##0";
  rc.getColumn("chapas").numFmt = "#,##0";

  // resumo por tipo de papel (ex.: P50D, P25B)
  const rpNome = `Resumo_Papel_${label}`;
  const rp = wb.addWorksheet(rpNome);
  rp.columns = [
    { header: "Papel", key: "p", width: 14 },
    { header: "Peso (kg)", key: "peso", width: 13 },
    { header: "Chapas", key: "chapas", width: 12 },
    { header: "Registros", key: "reg", width: 11 },
  ];
  headerRow(rp);
  d.papeis.forEach((pl, i) => {
    const r = i + 2;
    rp.addRow({
      p: pl.papel,
      peso: { formula: `SUMIFS(${detNome}!H2:H${lastRow},${detNome}!D2:D${lastRow},A${r})` },
      chapas: { formula: `SUMIFS(${detNome}!G2:G${lastRow},${detNome}!D2:D${lastRow},A${r})` },
      reg: { formula: `COUNTIFS(${detNome}!D2:D${lastRow},A${r})` },
    });
  });
  rp.getColumn("peso").numFmt = "#,##0";
  rp.getColumn("chapas").numFmt = "#,##0";

  const ws = wb.addWorksheet(`Dashboard_${label}`);
  ws.views = [{ showGridLines: false }];

  ws.mergeCells("B2:J3");
  const titleCell = ws.getCell("B2");
  titleCell.value = `DASHBOARD DE PRODUÇÃO — ${d.dataRef ? d.dataRef.split("-").reverse().join("/") : ""} — ${label.toUpperCase()}`;
  titleCell.font = { bold: true, size: 16, color: { argb: "FFFFFFFF" }, name: "Arial" };
  titleCell.alignment = { vertical: "middle", indent: 1 };
  for (let col = 2; col <= 10; col++) {
    ws.getRow(2).getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_ESCURO } };
    ws.getRow(3).getCell(col).fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_ESCURO } };
  }

  const kpiDefs = [
    ["VELOCIDADE MÉDIA (m/min)", d.velocidadeMedia.toFixed(2), "0.00"],
    ["LARGURA MÉDIA (mm)", d.larguraMedia != null ? d.larguraMedia.toFixed(0) : 0, "0"],
    ["PESO TOTAL (kg)", `SUM(${rcNome}!B2:B${d.clientes.length + 1})`, "#,##0"],
    ["CHAPAS PRODUZIDAS", `SUM(${rcNome}!C2:C${d.clientes.length + 1})`, "#,##0"],
  ];
  const cols = [["B", "C"], ["D", "E"], ["F", "G"], ["H", "J"]];
  kpiDefs.forEach(([label2, formula, fmtNum], i) => {
    const [c1, c2] = cols[i];
    ws.mergeCells(`${c1}6:${c2}6`);
    const lab = ws.getCell(`${c1}6`);
    lab.value = label2;
    lab.font = { bold: true, size: 10, color: { argb: "FFFFFFFF" }, name: "Arial" };
    lab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_MEDIO } };
    lab.alignment = { horizontal: "center", vertical: "middle", wrapText: true };
    ws.mergeCells(`${c1}7:${c2}9`);
    const val = ws.getCell(`${c1}7`);
    val.value = typeof formula === "string" && /[A-Za-z]\(/.test(formula) ? { formula } : Number(formula);
    val.numFmt = fmtNum;
    val.font = { bold: true, size: 22, name: "Arial" };
    val.fill = { type: "pattern", pattern: "solid", fgColor: { argb: CIANO } };
    val.alignment = { horizontal: "center", vertical: "middle" };
  });

  let row = 12;
  ws.mergeCells(`B${row}:J${row}`);
  ws.getCell(`B${row}`).value = "Resumo por cliente";
  ws.getCell(`B${row}`).font = { bold: true, color: { argb: "FF1F4E78" }, name: "Arial" };
  for (let c = 2; c <= 10; c++) ws.getRow(row).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
  row += 1;
  const hdrRow = row;
  ["Cliente", "Peso (kg)", "Chapas", "Registros"].forEach((h, i) => {
    const cell = ws.getRow(hdrRow).getCell(2 + i);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_ESCURO } };
  });
  d.clientes.forEach((cl, i) => {
    const r = hdrRow + 1 + i;
    ws.getRow(r).getCell(2).value = cl.cliente;
    ws.getRow(r).getCell(3).value = Math.round(cl.peso);
    ws.getRow(r).getCell(3).numFmt = "#,##0";
    ws.getRow(r).getCell(4).value = Math.round(cl.chapas);
    ws.getRow(r).getCell(4).numFmt = "#,##0";
    ws.getRow(r).getCell(5).value = cl.registros;
  });

  // resumo por tipo de papel, logo abaixo do resumo por cliente
  row = hdrRow + d.clientes.length + 2;
  ws.mergeCells(`B${row}:J${row}`);
  ws.getCell(`B${row}`).value = "Resumo por tipo de papel";
  ws.getCell(`B${row}`).font = { bold: true, color: { argb: "FF1F4E78" }, name: "Arial" };
  for (let c = 2; c <= 10; c++) ws.getRow(row).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: CINZA } };
  row += 1;
  const hdrRowPapel = row;
  ["Papel", "Peso (kg)", "Chapas", "Registros"].forEach((h, i) => {
    const cell = ws.getRow(hdrRowPapel).getCell(2 + i);
    cell.value = h;
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, name: "Arial" };
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: AZUL_ESCURO } };
  });
  d.papeis.forEach((pl, i) => {
    const r = hdrRowPapel + 1 + i;
    ws.getRow(r).getCell(2).value = pl.papel;
    ws.getRow(r).getCell(3).value = Math.round(pl.peso);
    ws.getRow(r).getCell(3).numFmt = "#,##0";
    ws.getRow(r).getCell(4).value = Math.round(pl.chapas);
    ws.getRow(r).getCell(4).numFmt = "#,##0";
    ws.getRow(r).getCell(5).value = pl.registros;
  });

  ws.getColumn(2).width = 26;
  for (const col of "CDEFGHIJ") ws.getColumn(col.charCodeAt(0) - 64).width = 13;
}

// Gera um único Excel replicando as 3 visões do app (Dia, Noite, Total),
// cada uma com dashboard, tabela detalhada (com tipo de papel), resumo por
// cliente e resumo por tipo de papel.
async function baixarExcel(views) {
  const wb = new ExcelJS.Workbook();

  const ordem = ["dia", "noite", "total"].filter((k) => views[k]);
  const total = views.total;

  // Painel único (pensado pra telão da fábrica): 3 blocos lado a lado —
  // Dia, Noite e Total — cada um com peso/chapas/velocidade e a lista de
  // tipos de papel produzidos com o % do peso de cada um.
  const TODAS_COLS = "BCDEFGHIJKL";
  const blocoCols = { dia: ["B", "D"], noite: ["F", "H"], total: ["J", "L"] };

  const geral = wb.addWorksheet("Resumo Geral");
  geral.views = [{ showGridLines: false }];
  geral.mergeCells("B2:L3");
  const titleCell = geral.getCell("B2");
  titleCell.value = `PRODUÇÃO — ${total && total.dataRef ? total.dataRef.split("-").reverse().join("/") : new Date().toLocaleDateString("pt-BR")}`;
  titleCell.font = { bold: true, size: 20, color: { argb: "FFFFFFFF" }, name: "Arial" };
  titleCell.alignment = { vertical: "middle", horizontal: "center" };
  for (const col of TODAS_COLS) {
    const c = col.charCodeAt(0) - 64;
    geral.getRow(2).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_CORES.AZUL_ESCURO } };
    geral.getRow(3).getCell(c).fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_CORES.AZUL_ESCURO } };
  }

  const maxPapeis = Math.max(1, ...["dia", "noite", "total"].map((k) => (views[k] ? views[k].papeis.length : 0)));
  const PAPEL_START_ROW = 13;

  ["dia", "noite", "total"].forEach((key) => {
    const [c1, c2] = blocoCols[key];
    const dv = views[key];

    geral.mergeCells(`${c1}6:${c2}6`);
    const lab = geral.getCell(`${c1}6`);
    lab.value = `PRODUÇÃO ${VIEW_LABELS[key].toUpperCase()}`;
    lab.font = { bold: true, size: 13, color: { argb: "FFFFFFFF" }, name: "Arial" };
    lab.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_CORES.AZUL_MEDIO } };
    lab.alignment = { horizontal: "center", vertical: "middle" };

    geral.mergeCells(`${c1}7:${c2}9`);
    const val = geral.getCell(`${c1}7`);
    val.value = dv ? Math.round(dv.pesoTotal) : "—";
    if (dv) val.numFmt = "#,##0";
    val.font = { bold: true, size: 28, name: "Arial" };
    val.fill = { type: "pattern", pattern: "solid", fgColor: { argb: key === "total" ? EXCEL_CORES.CIANO : EXCEL_CORES.CIANO_CLARO } };
    val.alignment = { horizontal: "center", vertical: "middle" };
    geral.mergeCells(`${c1}10:${c2}10`);
    geral.getCell(`${c1}10`).value = "kg produzidos";
    geral.getCell(`${c1}10`).font = { italic: true, size: 9, color: { argb: "FF595959" }, name: "Arial" };
    geral.getCell(`${c1}10`).alignment = { horizontal: "center" };

    geral.mergeCells(`${c1}11:${c2}11`);
    const sub = geral.getCell(`${c1}11`);
    sub.value = dv
      ? `${Math.round(dv.totalChapas).toLocaleString("pt-BR")} chapas   ·   ${dv.velocidadeMedia.toFixed(2)} m/min`
      : "Sem relatório carregado";
    sub.font = { bold: true, size: 11, color: { argb: "FF1F4E78" }, name: "Arial" };
    sub.alignment = { horizontal: "center" };

    geral.mergeCells(`${c1}${PAPEL_START_ROW}:${c2}${PAPEL_START_ROW}`);
    const papelHdr = geral.getCell(`${c1}${PAPEL_START_ROW}`);
    papelHdr.value = "TIPOS DE PAPEL (% DO PESO)";
    papelHdr.font = { bold: true, size: 9, color: { argb: "FFFFFFFF" }, name: "Arial" };
    papelHdr.fill = { type: "pattern", pattern: "solid", fgColor: { argb: EXCEL_CORES.AZUL_ESCURO } };
    papelHdr.alignment = { horizontal: "center", vertical: "middle" };

    for (let i = 0; i < maxPapeis; i++) {
      const r = PAPEL_START_ROW + 1 + i;
      geral.mergeCells(`${c1}${r}:${c2}${r}`);
      const cell = geral.getCell(`${c1}${r}`);
      const pl = dv && dv.papeis[i];
      if (pl) {
        const pct = dv.pesoTotal > 0 ? (pl.peso / dv.pesoTotal) * 100 : 0;
        cell.value = `${pl.papel} — ${pct.toFixed(0)}%`;
        cell.font = { size: 12, name: "Arial", bold: i === 0 };
      }
      cell.alignment = { horizontal: "center" };
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: i % 2 === 0 ? "FFFFFFFF" : EXCEL_CORES.CINZA } };
    }
  });

  for (const col of TODAS_COLS) geral.getColumn(col.charCodeAt(0) - 64).width = 12;
  geral.getColumn("E".charCodeAt(0) - 64).width = 3;
  geral.getColumn("I".charCodeAt(0) - 64).width = 3;
  geral.getRow(2).height = 20;
  geral.getRow(3).height = 20;
  for (let r = PAPEL_START_ROW + 1; r <= PAPEL_START_ROW + maxPapeis; r++) geral.getRow(r).height = 18;

  wb.views = [{ activeTab: 0 }];

  ordem.forEach((key) => gerarAbasDaVisao(wb, VIEW_LABELS[key], views[key]));

  const buffer = await wb.xlsx.writeBuffer();
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const a = document.createElement("a");
  const dataLabel = (total && total.dataRef) || new Date().toISOString().slice(0, 10);
  a.href = URL.createObjectURL(blob);
  a.download = `dashboard_producao_${dataLabel}.xlsx`;
  a.click();
}

// -------------------------------------------------------------- UI --------
function logStatus(msg, tipo = "") {
  const el = document.getElementById("status-log");
  const span = document.createElement("div");
  if (tipo) span.className = tipo;
  span.textContent = msg;
  el.appendChild(span);
}
function clearStatus() { document.getElementById("status-log").innerHTML = ""; }

function atualizarBotaoGerar() {
  const algum = state.arquivos.dia?.ok || state.arquivos.noite?.ok;
  document.getElementById("btn-gerar").disabled = !algum;
}

async function handleFileInput(slot, file) {
  const nameEl = document.getElementById(`file-${slot}-name`);
  if (!file) { state.arquivos[slot] = null; nameEl.textContent = "Nenhum arquivo"; atualizarBotaoGerar(); return; }
  nameEl.textContent = `Lendo ${file.name}…`;
  clearStatus();
  try {
    const result = await parseFile(file, slot);
    state.arquivos[slot] = result;
    if (result.ok) {
      nameEl.textContent = `${file.name} (${result.nOps} OPs)`;
      logStatus(`✓ ${slot.toUpperCase()}: ${file.name} — ${result.nOps} OPs lidas.`, "ok");
      (result.warnings || []).forEach((w) => logStatus(`  [${slot.toUpperCase()}] ${w}`, "aviso"));
    } else {
      nameEl.textContent = `Erro: ${file.name}`;
      logStatus(`✗ ${slot.toUpperCase()}: ${result.error}`, "erro");
    }
  } catch (e) {
    state.arquivos[slot] = { ok: false, error: String(e) };
    nameEl.textContent = `Erro: ${file.name}`;
    logStatus(`✗ ${slot.toUpperCase()}: ${e.message || e}`, "erro");
    console.error(e);
  }
  atualizarBotaoGerar();
}

function renderConfigGramatura() {
  const tbl = document.getElementById("tabela-gramatura");
  const entries = Object.entries(state.gramatura).sort((a, b) => b[1] - a[1]);
  tbl.innerHTML = `<thead><tr><th>Papel</th><th>kg/m²</th><th></th></tr></thead><tbody>
    ${entries.map(([papel, g], i) => `
      <tr data-idx="${i}">
        <td><input type="text" class="in-papel" value="${papel}"></td>
        <td><input type="number" step="0.001" class="in-gram" value="${g}"></td>
        <td><button class="remover" data-papel="${papel}" title="remover">✕</button></td>
      </tr>`).join("")}
  </tbody>`;

  tbl.querySelectorAll(".remover").forEach((btn) => {
    btn.addEventListener("click", () => {
      delete state.gramatura[btn.dataset.papel];
      saveGramatura();
      renderConfigGramatura();
    });
  });
  tbl.querySelectorAll("tr[data-idx]").forEach((tr) => {
    const inPapel = tr.querySelector(".in-papel");
    const inGram = tr.querySelector(".in-gram");
    const commit = () => {
      const papelAntigo = entries[Number(tr.dataset.idx)][0];
      const novoPapel = inPapel.value.trim().toUpperCase();
      const novoValor = parseFloat(inGram.value);
      if (!novoPapel || isNaN(novoValor)) return;
      if (papelAntigo !== novoPapel) delete state.gramatura[papelAntigo];
      state.gramatura[novoPapel] = novoValor;
      saveGramatura();
    };
    inPapel.addEventListener("change", commit);
    inGram.addEventListener("change", commit);
  });
}

document.addEventListener("DOMContentLoaded", () => {
  document.getElementById("file-dia").addEventListener("change", (e) => handleFileInput("dia", e.target.files[0]));
  document.getElementById("file-noite").addEventListener("change", (e) => handleFileInput("noite", e.target.files[0]));

  document.getElementById("btn-gerar").addEventListener("click", () => {
    state.dashboards = computeAllViews();
    renderTurnoCards(state.dashboards.total || null);
    const ordemPreferida = ["total", "dia", "noite"];
    state.activeView = ordemPreferida.find((k) => state.dashboards[k]) || null;
    renderViewTabs();
    if (state.activeView) renderDashboard(state.dashboards[state.activeView]);
  });

  document.getElementById("btn-baixar-excel").addEventListener("click", () => {
    if (state.dashboards && (state.dashboards.dia || state.dashboards.noite || state.dashboards.total)) {
      baixarExcel(state.dashboards);
    }
  });

  const toggleBtn = document.getElementById("toggle-config");
  toggleBtn.addEventListener("click", () => {
    const body = document.getElementById("config-body");
    const willShow = body.classList.contains("hidden");
    body.classList.toggle("hidden");
    toggleBtn.setAttribute("aria-expanded", String(willShow));
  });

  document.getElementById("btn-add-papel").addEventListener("click", () => {
    state.gramatura["NOVO"] = 0.4;
    saveGramatura();
    renderConfigGramatura();
  });
  document.getElementById("btn-reset-gramatura").addEventListener("click", () => {
    state.gramatura = { ...GRAMATURA_PADRAO };
    saveGramatura();
    renderConfigGramatura();
  });

  renderConfigGramatura();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
