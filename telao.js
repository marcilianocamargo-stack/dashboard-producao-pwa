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

// Resumo de produção em tempo real (paletes registrados hoje pelo app de
// etiquetas), publicado pelo mesmo GitHub Pages do app — sem depender de
// carregar relatório manualmente.
const RESUMO_HOJE_URL = "https://marcilianocamargo-stack.github.io/controle-producao-etiquetas/resumo-hoje.json";
let resumoHoje = null;

async function carregarResumoHoje() {
  try {
    const resp = await fetch(RESUMO_HOJE_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (resp.ok) resumoHoje = await resp.json();
  } catch (e) { /* mantém o último valor conhecido se a rede falhar */ }
}

// Meta mensal compartilhada — publicada pelo app.js sempre que alguém salva
// a meta em QUALQUER aparelho, pra todo mundo ver o mesmo número (a meta
// mensal ficava só no localStorage, por aparelho, e cada tela mostrava um
// valor diferente). Sem essa fonte disponível (rede caiu, nunca foi
// publicada ainda), cai pro localStorage local do próprio aparelho.
const META_MENSAL_URL = "https://marcilianocamargo-stack.github.io/dashboard-producao-pwa/meta-mensal.json";
let metaMensalCompartilhada = null;

async function carregarMetaMensalCompartilhada() {
  try {
    const resp = await fetch(META_MENSAL_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (resp.ok) {
      const dados = await resp.json();
      if (dados && dados.metaMensal > 0) metaMensalCompartilhada = dados.metaMensal;
    }
  } catch (e) { /* mantém o último valor conhecido / cai pro local */ }
}

// Turno Dia: 06h-18h. Turno Noite: 18h-06h.
function turnoAtual() {
  const h = new Date().getHours();
  return (h >= 6 && h < 18) ? "dia" : "noite";
}
function hojeStrBR() {
  const d = new Date();
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
}

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
  if (metaMensalCompartilhada > 0) return metaMensalCompartilhada;
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

function mergePorChave(chave, ...listas) {
  const mapa = {};
  for (const lista of listas) {
    for (const item of lista || []) {
      const k = item[chave];
      if (!mapa[k]) mapa[k] = { [chave]: k, chapas: 0, peso: 0 };
      mapa[k].chapas += item.chapas || 0;
      mapa[k].peso += item.peso || 0;
    }
  }
  return Object.values(mapa).sort((a, b) => b.peso - a.peso);
}
function mergePapeis(...listas) { return mergePorChave("papel", ...listas); }
function mergeClientes(...listas) { return mergePorChave("cliente", ...listas); }

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
const CLIENTES_DEMO = ["UPAPER", "RENOVAPEL RECICLAGEM DE PAPEIS LTDA", "DR EMBALAGENS", "SÃO MIGUEL"];

function gerarDadosDemo(ano, mesIdx, metaDiaria) {
  const daysInMonth = new Date(ano, mesIdx + 1, 0).getDate();
  const diasDemo = Math.min(daysInMonth - 1, 18);
  const dados = {};
  for (let d = 1; d <= diasDemo; d++) {
    const util = isDiaUtil(ano, mesIdx, d);
    // fim de semana só produz nos dias de "recuperação" (fator baixo no dia
    // útil anterior), pra ilustrar o mesmo padrão real da fábrica.
    const recuperando = !util && d > 2; // 1º fim de semana do mês fica de fora só pra também mostrar o caso "parado" na demonstração
    const fator = util ? DEMO_FATORES[(d - 1) % DEMO_FATORES.length] : (recuperando ? 0.55 : 0);
    const totalPeso = metaDiaria * fator;
    const shareDia = 0.5 + 0.06 * Math.sin(d * 1.7);
    const pesoDia = totalPeso * shareDia;
    const pesoNoite = totalPeso - pesoDia;
    const mk = (peso, offset) => {
      const chapas = Math.round(peso / 3.3);
      const papelA = PAPEIS_DEMO[d % PAPEIS_DEMO.length];
      const papelB = PAPEIS_DEMO[(d + offset + 1) % PAPEIS_DEMO.length];
      const clienteA = CLIENTES_DEMO[d % CLIENTES_DEMO.length];
      const clienteB = CLIENTES_DEMO[(d + offset + 2) % CLIENTES_DEMO.length];
      const splitA = 0.62;
      return {
        peso,
        chapas,
        velocidade: peso > 0 ? 68 + ((d * 7 + offset) % 20) : 0,
        papeis: peso > 0 ? [
          { papel: papelA, chapas: Math.round(chapas * splitA), peso: Math.round(peso * splitA) },
          { papel: papelB, chapas: Math.round(chapas * (1 - splitA)), peso: Math.round(peso * (1 - splitA)) },
        ] : [],
        clientes: peso > 0 ? [
          { cliente: clienteA, chapas: Math.round(chapas * 0.7), peso: Math.round(peso * 0.7) },
          { cliente: clienteB, chapas: Math.round(chapas * 0.3), peso: Math.round(peso * 0.3) },
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
        clientes: mergeClientes(diaTurno.clientes, noiteTurno.clientes),
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
    projecaoFechamento, projecaoPct, porDia, ultimoDiaStr, ultimoDiaEntry, isDemo, dadosMes,
  };
}

// "DD/MM/YYYY" (formato que o app de etiquetas manda) -> "YYYY-MM-DD"
// (formato que o relatório carregado manualmente usa como chave).
function dataBRparaISO(dataBR){
  const [d, m, y] = String(dataBR||"").split("/");
  if (!d || !m || !y) return null;
  return `${y}-${m.padStart(2,"0")}-${d.padStart(2,"0")}`;
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
    const papeisEl = document.getElementById(`tl-${prefixo}-papeis`);
    const papeis = (dados && dados.papeis) || [];
    papeisEl.textContent = papeis.length
      ? papeis.map((p) => `${p.papel} ${fmt(p.chapas, 0)}`).join("  ·  ")
      : "—";

    const clientesEl = document.getElementById(`tl-${prefixo}-clientes`);
    const clientes = (dados && dados.clientes) || [];
    const TOP_CLIENTES = 3;
    if (!clientes.length) {
      clientesEl.textContent = "—";
    } else {
      const principais = clientes.slice(0, TOP_CLIENTES)
        .map((c) => `<b>${c.cliente}</b> ${fmt(c.chapas, 0)}`).join("  ·  ");
      const resto = clientes.length - TOP_CLIENTES;
      clientesEl.innerHTML = principais + (resto > 0 ? `  ·  +${resto} outro(s)` : "");
    }
  };

  // Os cartões de turno sempre mostram o ÚLTIMO turno já FECHADO de cada
  // tipo (nunca o que está em andamento). Cruza as duas fontes: usa o
  // tempo real (app de etiquetas) quando já existe dado pra aquela data;
  // se não existir (datas de antes do sistema em tempo real existir),
  // cai pro relatório carregado manualmente na tela de configuração —
  // assim cobre o histórico antigo e segue sozinho a partir de hoje.
  function turnoFechadoOuManual(fechado, tipo){
    if (fechado && fechado.paletes) return fechado;
    if (p.isDemo) return null;
    const iso = dataBRparaISO(fechado && fechado.data);
    const doMes = iso && p.dadosMes && p.dadosMes[iso];
    return (doMes && doMes[tipo] && doMes[tipo].peso) ? doMes[tipo] : null;
  }

  const tituloTurnos = document.getElementById("tl-turnos-titulo");
  if (resumoHoje && resumoHoje.turnoDiaFechado && resumoHoje.turnoNoiteFechado) {
    const diaData = resumoHoje.turnoDiaFechado.data;
    const noiteData = resumoHoje.turnoNoiteFechado.data;
    setTurno("dia", turnoFechadoOuManual(resumoHoje.turnoDiaFechado, "dia"));
    setTurno("noite", turnoFechadoOuManual(resumoHoje.turnoNoiteFechado, "noite"));
    setTurno("total", { peso: resumoHoje.pesoHoje, chapas: resumoHoje.chapasHoje });
    document.querySelector("#tl-box-dia .tl-turno-nome").textContent = `TURNO DIA · ${diaData}`;
    document.querySelector("#tl-box-noite .tl-turno-nome").textContent = `TURNO NOITE · ${noiteData}`;
    tituloTurnos.textContent = "Último turno fechado de cada tipo";
  } else {
    setTurno("dia", p.ultimoDiaEntry ? p.ultimoDiaEntry.dia : null);
    setTurno("noite", p.ultimoDiaEntry ? p.ultimoDiaEntry.noite : null);
    setTurno("total", p.ultimoDiaEntry ? p.ultimoDiaEntry.total : null);
    if (p.ultimoDiaStr) {
      const [y, m, d] = p.ultimoDiaStr.split("-");
      tituloTurnos.textContent = `Produção do dia ${d}/${m}`;
    } else {
      tituloTurnos.textContent = "Produção do dia anterior";
    }
  }

  // Número grande de tempo real: acumula o dia inteiro (não reseta na troca
  // de turno) — vermelho enquanto não bate a meta diária cheia, azul assim
  // que atinge/passa. Os cartões de turno ao lado (setTurno acima) ficam
  // segmentados por turno, fechando cada um quando o horário vira.
  const turno = turnoAtual();
  const turnoLabel = turno === "dia" ? "Turno Dia" : "Turno Noite";
  const pesoHojeAtual = (resumoHoje && resumoHoje.pesoHoje) || 0;
  const metaDiaria = p.metaDiaria || 0;
  const atingiuMeta = metaDiaria > 0 && pesoHojeAtual >= metaDiaria;

  document.getElementById("tl-tempo-real-titulo").textContent =
    `Produção hoje — ${turnoLabel} em andamento`;

  const numeroWrap = document.getElementById("tl-numero-hoje").parentElement;
  numeroWrap.classList.toggle("tl-bateu", atingiuMeta);
  numeroWrap.classList.toggle("tl-abaixo", !atingiuMeta);
  document.getElementById("tl-numero-hoje").innerHTML =
    `${fmt(pesoHojeAtual)}<small>kg</small>`;
  document.getElementById("tl-numero-hoje-sub").textContent =
    `de ${fmt(metaDiaria)} kg (meta diária)`;

  // Só a produção do turno vigente (não o dia inteiro) — pra quem está
  // trabalhando agora, principalmente à noite, ver o que ELE produziu,
  // sem misturar com o que o turno anterior já tinha feito no mesmo dia.
  const turnoAtualDados = resumoHoje && resumoHoje.turnoAtual;
  document.getElementById("tl-numero-turno-atual").innerHTML = turnoAtualDados
    ? `Só neste turno (${turnoLabel}): <b>${fmt(turnoAtualDados.peso)} kg</b> · ${fmt(turnoAtualDados.chapas)} chapas`
    : "—";

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
  // Fim de semana não tem meta — comparar com a linha dos dias úteis ficaria
  // enganoso (pareceria "abaixo da meta" mesmo quando é só produção extra,
  // fora do padrão). Por isso ganha uma cor própria (verde = bônus),
  // separada de azul (bateu a meta do dia útil) e vermelho (não bateu).
  const cores = p.porDia.map((x) => {
    if (x.dia > p.diasCorridos || x.peso === null) return "#D9D9D9";
    if (!x.util) return x.peso > 0 ? "#1BAF7A" : "#D9D9D9";
    return x.peso >= p.metaDiaria ? "#2E75B6" : "#C0392B";
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

document.addEventListener("DOMContentLoaded", async () => {
  renderRelogio();
  await Promise.all([carregarResumoHoje(), carregarMetaMensalCompartilhada()]);
  renderPainel();
  setInterval(renderRelogio, 1000);
  setInterval(async () => {
    // re-lê o localStorage (relatórios carregados manualmente) e busca o
    // resumo de tempo real e a meta mensal publicados pelos outros apps
    await Promise.all([carregarResumoHoje(), carregarMetaMensalCompartilhada()]);
    renderPainel();
  }, 60000);
  registrarServiceWorker();
});

// Verifica de tempos em tempos se há uma versão nova publicada e recarrega
// sozinho quando ela assume — a tela do telão normalmente é aberta direto
// nessa página (sem passar pela tela 1), então precisa registrar o Service
// Worker aqui também, não só em app.js.
function registrarServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  navigator.serviceWorker.register("sw.js").then((reg) => {
    setInterval(() => reg.update(), 5 * 60 * 1000);
  }).catch(() => {});
  navigator.serviceWorker.addEventListener("controllerchange", () => location.reload());
}
