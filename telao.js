/* Painel de Produção — Telão
 * Lê o histórico mensal salvo pelo dashboard principal (app.js) e a meta
 * mensal, calcula "onde estamos" em relação ao ritmo necessário para bater
 * a meta, e desenha o calendário do mês (dia 01 até o último dia do mês).
 * Mesmas chaves de localStorage do app.js — os dois arquivos rodam
 * separados (sem bundler), então os nomes das chaves e o formato dos dados
 * salvos têm que continuar iguais nos dois lados.
 */

const HISTORICO_KEY = "prime_historico_mensal_v1";
const META_MENSAL_KEY = "prime_meta_mensal_v1";
const META_MENSAL_PADRAO = 150000;

const MESES_PT = ["janeiro","fevereiro","março","abril","maio","junho","julho","agosto","setembro","outubro","novembro","dezembro"];
const DIAS_SEMANA_PT = ["domingo","segunda-feira","terça-feira","quarta-feira","quinta-feira","sexta-feira","sábado"];

function loadHistorico() {
  try {
    const saved = localStorage.getItem(HISTORICO_KEY);
    if (saved) return JSON.parse(saved);
  } catch (e) { /* ignore */ }
  return {};
}
function loadMetaMensal() {
  try {
    const saved = localStorage.getItem(META_MENSAL_KEY);
    if (saved) {
      const v = parseFloat(saved);
      if (!isNaN(v) && v > 0) return v;
    }
  } catch (e) { /* ignore */ }
  return META_MENSAL_PADRAO;
}

function fmt(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  return n.toLocaleString("pt-BR", { minimumFractionDigits: dec, maximumFractionDigits: dec });
}
function fmtSigned(n, dec = 0) {
  if (n === null || n === undefined || isNaN(n)) return "—";
  const sinal = n > 0 ? "+" : n < 0 ? "−" : "";
  return `${sinal}${fmt(Math.abs(n), dec)}`;
}

// A fábrica produz normalmente só em dias úteis (segunda a sexta); sábado e
// domingo só entram quando estão recuperando atraso. Por isso a meta diária
// e o "onde estamos" usam dias úteis como base, não o total de dias do mês.
function isDiaUtil(ano, mesIdx, dia) {
  const dow = new Date(ano, mesIdx, dia).getDay(); // 0 = domingo, 6 = sábado
  return dow !== 0 && dow !== 6;
}
function contarDiasUteis(ano, mesIdx, diaIni, diaFim) {
  let n = 0;
  for (let d = diaIni; d <= diaFim; d++) if (isDiaUtil(ano, mesIdx, d)) n++;
  return n;
}

function mergePapeis(...listas) {
  const mapa = {};
  for (const lista of listas) {
    for (const p of lista || []) {
      if (!mapa[p.papel]) mapa[p.papel] = { papel: p.papel, chapas: 0, peso: 0 };
      mapa[p.papel].chapas += p.chapas || 0;
      mapa[p.papel].peso += p.peso || 0;
    }
  }
  return Object.values(mapa).sort((a, b) => b.peso - a.peso);
}

// ------------------------------------------------------ DADOS DE DEMO -----
// Padrão fixo de "% da meta diária batida" por dia — inclui altos e baixos
// (turnos parados, manutenção etc.) pra mostrar o painel funcionando nos
// dois estados (verde/vermelho) mesmo sem histórico real ainda. Usado só
// quando o mês corrente não tem nenhum dia real salvo.
const DEMO_FATORES = [
  1.04, 0.97, 1.08, 0.62, 1.12, 0.95, 1.01, 0.89, 1.15, 0.84,
  0.58, 1.18, 1.02, 0.93, 1.06, 0.99, 0.68, 1.11, 1.00, 0.91,
  0.87, 1.14, 1.03, 0.96, 0.64, 1.07, 1.09, 0.90, 1.00, 0.94, 1.02,
];

const PAPEIS_DEMO = ["P25B", "P50D", "P70D", "PK45C"];

function gerarDadosDemo(ano, mesIdx, metaDiaria) {
  const daysInMonth = new Date(ano, mesIdx + 1, 0).getDate();
  const diasDemo = Math.min(daysInMonth - 1, 18);
  const dados = {};
  for (let d = 1; d <= diasDemo; d++) {
    const util = isDiaUtil(ano, mesIdx, d);
    // fim de semana só produz nos dias de "recuperação" (fator baixo no dia
    // útil anterior), pra ilustrar o mesmo padrão real da fábrica.
    const recuperando = !util && DEMO_FATORES[(d - 2 + DEMO_FATORES.length) % DEMO_FATORES.length] < 0.7;
    const fator = util ? DEMO_FATORES[(d - 1) % DEMO_FATORES.length] : (recuperando ? 0.55 : 0);
    const totalPeso = metaDiaria * fator;
    const shareDia = 0.5 + 0.06 * Math.sin(d * 1.7);
    const pesoDia = totalPeso * shareDia;
    const pesoNoite = totalPeso - pesoDia;
    const mk = (peso, offset) => {
      const chapas = Math.round(peso / 3.3);
      const papelA = PAPEIS_DEMO[d % PAPEIS_DEMO.length];
      const papelB = PAPEIS_DEMO[(d + offset + 1) % PAPEIS_DEMO.length];
      const splitA = 0.62;
      return {
        peso,
        chapas,
        velocidade: peso > 0 ? 68 + ((d * 7 + offset) % 20) : 0,
        papeis: peso > 0 ? [
          { papel: papelA, chapas: Math.round(chapas * splitA), peso: Math.round(peso * splitA) },
          { papel: papelB, chapas: Math.round(chapas * (1 - splitA)), peso: Math.round(peso * (1 - splitA)) },
        ] : [],
      };
    };
    const diaTurno = mk(pesoDia, 0);
    const noiteTurno = mk(pesoNoite, 9);
    const dataStr = `${ano}-${String(mesIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    dados[dataStr] = {
      data: dataStr,
      dia: diaTurno,
      noite: noiteTurno,
      total: {
        peso: totalPeso,
        chapas: diaTurno.chapas + noiteTurno.chapas,
        velocidade: totalPeso > 0 ? (diaTurno.velocidade + noiteTurno.velocidade) / 2 : 0,
        papeis: mergePapeis(diaTurno.papeis, noiteTurno.papeis),
      },
    };
  }
  return { dados, diasCorridos: diasDemo };
}

// --------------------------------------------------------------- CÁLCULO --
function montarPainel() {
  const agora = new Date();
  const ano = agora.getFullYear();
  const mesIdx = agora.getMonth(); // 0-based
  const mesRef = `${ano}-${String(mesIdx + 1).padStart(2, "0")}`;
  const daysInMonth = new Date(ano, mesIdx + 1, 0).getDate();
  const diasUteisNoMes = contarDiasUteis(ano, mesIdx, 1, daysInMonth);
  const metaMensal = loadMetaMensal();
  const metaDiaria = metaMensal / diasUteisNoMes;

  const historico = loadHistorico();
  const mesReal = historico[mesRef] || {};
  const diasReais = Object.keys(mesReal).sort();

  let dadosMes, diasCorridos, isDemo;
  if (diasReais.length) {
    dadosMes = mesReal;
    const ultimoDia = diasReais[diasReais.length - 1];
    diasCorridos = parseInt(ultimoDia.slice(8, 10), 10);
    isDemo = false;
  } else {
    const demo = gerarDadosDemo(ano, mesIdx, metaDiaria);
    dadosMes = demo.dados;
    diasCorridos = demo.diasCorridos;
    isDemo = true;
  }

  const diasUteisCorridos = contarDiasUteis(ano, mesIdx, 1, diasCorridos);
  const metaAcumulada = metaDiaria * diasUteisCorridos;
  let produzidoAcumulado = 0;
  const porDia = [];
  for (let d = 1; d <= daysInMonth; d++) {
    const dataStr = `${ano}-${String(mesIdx + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    const entry = dadosMes[dataStr];
    const peso = entry ? entry.total.peso : null;
    if (peso !== null && d <= diasCorridos) produzidoAcumulado += peso;
    porDia.push({ dia: d, peso, util: isDiaUtil(ano, mesIdx, d) });
  }

  const ondeEstamosKg = produzidoAcumulado - metaAcumulada;
  const ondeEstamosDias = metaDiaria > 0 ? ondeEstamosKg / metaDiaria : 0;
  const ritmoMedioPorDiaUtil = diasUteisCorridos > 0 ? produzidoAcumulado / diasUteisCorridos : 0;
  const projecaoFechamento = ritmoMedioPorDiaUtil * diasUteisNoMes;
  const projecaoPct = metaMensal > 0 ? (projecaoFechamento / metaMensal) * 100 : 0;

  const ultimoDiaStr = diasCorridos > 0
    ? `${ano}-${String(mesIdx + 1).padStart(2, "0")}-${String(diasCorridos).padStart(2, "0")}`
    : null;
  const ultimoDiaEntry = ultimoDiaStr ? dadosMes[ultimoDiaStr] : null;

  return {
    ano, mesIdx, daysInMonth, diasUteisNoMes, metaMensal, metaDiaria, diasCorridos, diasUteisCorridos,
    metaAcumulada, produzidoAcumulado, ondeEstamosKg, ondeEstamosDias,
    projecaoFechamento, projecaoPct, porDia, ultimoDiaStr, ultimoDiaEntry, isDemo,
  };
}

// --------------------------------------------------------------- RENDER --
let tlChart = null;

function renderRelogio() {
  const agora = new Date();
  document.getElementById("tl-relogio").textContent = agora.toLocaleTimeString("pt-BR");
  document.getElementById("tl-data").textContent =
    `${DIAS_SEMANA_PT[agora.getDay()]}, ${agora.toLocaleDateString("pt-BR")}`;
}

function renderPainel() {
  const p = montarPainel();

  document.getElementById("tl-mes-nome").textContent = `${MESES_PT[p.mesIdx]} de ${p.ano}`;

  document.getElementById("kpi-meta").textContent = fmt(p.metaMensal);
  document.getElementById("kpi-meta-sub").textContent = `${fmt(p.metaMensal / 1000, 0)} toneladas`;

  document.getElementById("kpi-produzido").textContent = fmt(p.produzidoAcumulado);
  document.getElementById("kpi-produzido-sub").textContent =
    p.diasCorridos > 0
      ? `até dia ${p.diasCorridos} · projeção de fechamento: ${fmt(p.projecaoFechamento)} kg (${fmt(p.projecaoPct, 0)}%)`
      : "sem dados lançados ainda";

  document.getElementById("kpi-meta-diaria").textContent = fmt(p.metaDiaria);
  document.getElementById("kpi-meta-diaria-sub").textContent = `${p.diasUteisNoMes} dias úteis no mês (${p.daysInMonth} no total)`;

  const heroBox = document.getElementById("kpi-hero");
  const estamosEl = document.getElementById("kpi-estamos");
  const estamosSubEl = document.getElementById("kpi-estamos-sub");
  heroBox.classList.remove("tl-positivo", "tl-negativo");
  if (p.diasCorridos > 0) {
    const positivo = p.ondeEstamosKg >= 0;
    heroBox.classList.add(positivo ? "tl-positivo" : "tl-negativo");
    estamosEl.innerHTML = `${fmtSigned(p.ondeEstamosKg)} <small>kg</small>`;
    const diasTxt = `${fmtSigned(p.ondeEstamosDias, 1)} dia(s) de produção`;
    // "recuperar no próximo turno" só faz sentido pra um atraso pequeno
    // (menos de meio dia = 1 turno). Atrasos maiores precisam do número
    // real de dias — prometer "próximo turno" com -2,2 dias de atraso, por
    // exemplo, é impossível e passa confiança errada pro time.
    const diasAtraso = Math.abs(p.ondeEstamosDias);
    const diasParaRecuperar = Math.ceil(diasAtraso);
    const acaoRecuperar = diasAtraso <= 0.5
      ? "recuperar no próximo turno"
      : `recuperar em ${diasParaRecuperar} dia${diasParaRecuperar > 1 ? "s" : ""} mantendo o reforço`;
    estamosSubEl.textContent = positivo
      ? `Adiantado — ${diasTxt}`
      : `Atrasado — ${diasTxt} · ${acaoRecuperar}`;
  } else {
    estamosEl.textContent = "—";
    estamosSubEl.textContent = "aguardando o primeiro dia do mês";
  }

  // turnos do último dia com produção lançada
  const setTurno = (prefixo, dados) => {
    document.getElementById(`tl-${prefixo}-peso`).textContent = dados ? fmt(dados.peso) : "—";
    document.getElementById(`tl-${prefixo}-chapas`).textContent = dados ? fmt(dados.chapas) : "—";
    document.getElementById(`tl-${prefixo}-vel`).textContent = dados ? `${fmt(dados.velocidade, 2)} m/min` : "—";
    const papeisEl = document.getElementById(`tl-${prefixo}-papeis`);
    const papeis = (dados && dados.papeis) || [];
    papeisEl.textContent = papeis.length
      ? papeis.map((p) => `${p.papel} ${fmt(p.chapas, 0)}`).join("  ·  ")
      : "—";
  };
  setTurno("dia", p.ultimoDiaEntry ? p.ultimoDiaEntry.dia : null);
  setTurno("noite", p.ultimoDiaEntry ? p.ultimoDiaEntry.noite : null);
  setTurno("total", p.ultimoDiaEntry ? p.ultimoDiaEntry.total : null);

  const tituloTurnos = document.getElementById("tl-turnos-titulo");
  if (p.ultimoDiaStr) {
    const [y, m, d] = p.ultimoDiaStr.split("-");
    tituloTurnos.textContent = `Produção do dia ${d}/${m}`;
  } else {
    tituloTurnos.textContent = "Produção do dia anterior";
  }

  document.getElementById("tl-demo-badge").classList.toggle("hidden", !p.isDemo);
  document.getElementById("tl-atualizado").textContent =
    `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}${p.isDemo ? " · dados de demonstração" : ""}`;

  renderGrafico(p);
}

function renderGrafico(p) {
  const labels = p.porDia.map((x) => x.dia);
  const realizado = p.porDia.map((x) => (x.dia <= p.diasCorridos ? Math.round(x.peso || 0) : null));
  // Sábado/domingo não têm meta (produção só acontece lá quando estão
  // recuperando atraso) — por isso o alvo de comparação cai pra zero nesses
  // dias, em vez de cobrar a meta de dia útil num dia que não deveria nem
  // ter produção.
  const cores = p.porDia.map((x) => {
    if (x.dia > p.diasCorridos || x.peso === null) return "#D9D9D9";
    const alvo = x.util ? p.metaDiaria : 0;
    return x.peso >= alvo ? "#2E75B6" : "#C0392B";
  });
  const metaLinha = p.porDia.map(() => Math.round(p.metaDiaria));

  const ctx = document.getElementById("tl-chart-mes");
  if (tlChart) tlChart.destroy();
  tlChart = new Chart(ctx, {
    data: {
      labels,
      datasets: [
        {
          type: "bar",
          label: "Produzido (kg)",
          data: realizado,
          backgroundColor: cores,
          borderRadius: 3,
          order: 2,
        },
        {
          type: "line",
          label: "Meta diária (kg)",
          data: metaLinha,
          borderColor: "#1F4E78",
          borderWidth: 2,
          borderDash: [6, 4],
          pointRadius: 0,
          fill: false,
          order: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: true, position: "top", labels: { boxWidth: 14, font: { size: 11 } } },
        tooltip: { callbacks: { title: (items) => `Dia ${items[0].label}` } },
      },
      scales: {
        x: { title: { display: true, text: "dia do mês", font: { size: 10 } }, ticks: { font: { size: 9 } } },
        y: { title: { display: true, text: "kg", font: { size: 10 } }, ticks: { font: { size: 9 } } },
      },
    },
  });
}

document.addEventListener("DOMContentLoaded", () => {
  renderRelogio();
  renderPainel();
  setInterval(renderRelogio, 1000);
  setInterval(renderPainel, 60000); // re-lê o localStorage pra pegar dados novos gerados no app principal
});
