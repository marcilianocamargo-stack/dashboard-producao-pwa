/* Painel de Produção — Telão
 * Lê o histórico mensal compartilhado (historico-mensal.json, alimentado
 * automaticamente na VPS a cada palete etiquetado) e a meta mensal, calcula
 * "onde estamos" em relação ao ritmo necessário para bater a meta, e
 * desenha o calendário do mês (dia 01 até o último dia do mês).
 * O botão "Produção anterior" mostra semana atual/passada, mês passado e
 * qualquer mês que já esteja no histórico (ver periodo.js).
 * (A antiga tela de upload manual de relatórios foi arquivada em
 * 04/11/2026 — ver G:\Meu Drive\claude-contexto\arquivo-leitor-planilhas-dashboard.)
 */

const META_MENSAL_KEY = "prime_meta_mensal_v1";
const META_MENSAL_PADRAO = 150000;

// Alterna o gráfico entre "mês inteiro" e "últimos 7 dias" -- guarda o
// último painel calculado pra não precisar remontar tudo, só redesenhar o
// gráfico com a janela de dias diferente.
let visaoGrafico = "mes";
let ultimoPainel = null;

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
// Depois que alguém salva uma meta nova neste aparelho, o arquivo publicado
// no GitHub Pages demora alguns minutos pra refletir — durante esse tempo
// não deixa a leitura remota (ainda antiga) sobrescrever o valor recém-salvo.
let metaLocalValidaAte = 0;

async function carregarMetaMensalCompartilhada() {
  try {
    const resp = await fetch(META_MENSAL_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (resp.ok) {
      const dados = await resp.json();
      if (dados && dados.metaMensal > 0 && Date.now() > metaLocalValidaAte) metaMensalCompartilhada = dados.metaMensal;
    }
  } catch (e) { /* mantém o último valor conhecido / cai pro local */ }
}

// Histórico mensal compartilhado — publicado automaticamente pela VPS
// (registrar_palete_live.py) a cada palete, pra o telão mostrar o mesmo mês
// em qualquer tela.
const HISTORICO_MENSAL_URL = "https://marcilianocamargo-stack.github.io/dashboard-producao-pwa/historico-mensal.json";
let historicoMensalCompartilhado = {};

async function carregarHistoricoMensalCompartilhado() {
  try {
    const resp = await fetch(HISTORICO_MENSAL_URL + "?t=" + Date.now(), { cache: "no-store" });
    if (resp.ok) {
      const dados = await resp.json();
      if (dados && typeof dados === "object") historicoMensalCompartilhado = dados;
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

// Produção de um dia específico ("YYYY-MM-DD") no histórico compartilhado.
function entradaDoDia(iso) {
  const mes = historicoMensalCompartilhado[iso.slice(0, 7)];
  return (mes && mes[iso]) || null;
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

  const dadosMes = historicoMensalCompartilhado[mesRef] || {};
  const diasReais = Object.keys(dadosMes).sort();
  // Sem nenhum dia lançado no mês ainda (ex.: logo na virada), o painel fica
  // zerado em vez de inventar números.
  const diasCorridos = diasReais.length
    ? parseInt(diasReais[diasReais.length - 1].slice(8, 10), 10)
    : 0;

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
    projecaoFechamento, projecaoPct, porDia, ultimoDiaStr, ultimoDiaEntry, dadosMes,
  };
}

// "DD/MM/YYYY" (formato que o app de etiquetas manda) -> "YYYY-MM-DD"
// (formato usado como chave no histórico mensal).
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
  // cai pro histórico mensal compartilhado.
  function turnoFechadoOuHistorico(fechado, tipo){
    if (fechado && fechado.paletes) return fechado;
    const iso = dataBRparaISO(fechado && fechado.data);
    const doMes = iso && p.dadosMes && p.dadosMes[iso];
    return (doMes && doMes[tipo] && doMes[tipo].peso) ? doMes[tipo] : null;
  }

  const tituloTurnos = document.getElementById("tl-turnos-titulo");
  if (resumoHoje && resumoHoje.turnoDiaFechado && resumoHoje.turnoNoiteFechado) {
    const diaData = resumoHoje.turnoDiaFechado.data;
    const noiteData = resumoHoje.turnoNoiteFechado.data;
    setTurno("dia", turnoFechadoOuHistorico(resumoHoje.turnoDiaFechado, "dia"));
    setTurno("noite", turnoFechadoOuHistorico(resumoHoje.turnoNoiteFechado, "noite"));
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

  document.getElementById("tl-atualizado").textContent =
    `Atualizado às ${new Date().toLocaleTimeString("pt-BR")}`;

  ultimoPainel = p;
  renderGrafico(p);
}

// Monta os últimos 7 dias corridos (hoje incluso), podendo atravessar a
// virada do mês -- por isso busca o histórico do mês certo pra cada dia em
// vez de reaproveitar só o mês atual como o resto do painel faz.
function calcularUltimos7Dias() {
  const hoje = new Date();
  const dias = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate() - i);
    const ano = d.getFullYear(), mesIdx = d.getMonth(), dia = d.getDate();
    const mesRef = `${ano}-${String(mesIdx + 1).padStart(2, "0")}`;
    const dataISO = `${mesRef}-${String(dia).padStart(2, "0")}`;
    const entry = entradaDoDia(dataISO);
    dias.push({
      label: `${String(dia).padStart(2, "0")}/${String(mesIdx + 1).padStart(2, "0")}`,
      peso: entry ? entry.total.peso : 0,
      util: isDiaUtil(ano, mesIdx, dia),
    });
  }
  return dias;
}

function alternarVisaoGrafico(v) {
  visaoGrafico = v;
  document.getElementById("btn-visao-mes").classList.toggle("ativo", v === "mes");
  document.getElementById("btn-visao-semana").classList.toggle("ativo", v === "semana");
  document.getElementById("tl-titulo-grafico").textContent = v === "mes"
    ? "Produção diária do mês — realizado × meta"
    : "Produção dos últimos 7 dias — realizado × meta";
  if (ultimoPainel) renderGrafico(ultimoPainel);
}

function renderGrafico(p) {
  const modoSemana = visaoGrafico === "semana";
  const diasView = modoSemana ? calcularUltimos7Dias() : p.porDia;

  const labels = modoSemana ? diasView.map((x) => x.label) : diasView.map((x) => x.dia);
  // No mês, dia futuro (ainda não chegou) fica sem barra (null); nos
  // últimos 7 dias todo dia já é passado ou hoje, então sempre tem barra
  // (0 quando não tem produção lançada ainda).
  const realizado = modoSemana
    ? diasView.map((x) => Math.round(x.peso || 0))
    : diasView.map((x) => (x.dia <= p.diasCorridos ? Math.round(x.peso || 0) : null));
  // Sábado/domingo não têm meta (produção só acontece lá quando estão
  // recuperando atraso) — por isso o alvo de comparação cai pra zero nesses
  // dias, em vez de cobrar a meta de dia útil num dia que não deveria nem
  // ter produção.
  // Fim de semana não tem meta — comparar com a linha dos dias úteis ficaria
  // enganoso (pareceria "abaixo da meta" mesmo quando é só produção extra,
  // fora do padrão). Por isso ganha uma cor própria (verde = bônus),
  // separada de azul (bateu a meta do dia útil) e vermelho (não bateu).
  const cores = modoSemana
    ? diasView.map((x) => {
        if (!x.util) return x.peso > 0 ? "#2e7d32" : "#cfdcec";
        return x.peso >= p.metaDiaria ? "#1a56a0" : "#c62828";
      })
    : diasView.map((x) => {
        if (x.dia > p.diasCorridos || x.peso === null) return "#cfdcec";
        if (!x.util) return x.peso > 0 ? "#2e7d32" : "#cfdcec";
        return x.peso >= p.metaDiaria ? "#1a56a0" : "#c62828";
      });
  const metaLinha = diasView.map(() => Math.round(p.metaDiaria));

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
          borderColor: "#1b2b40",
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
        tooltip: { callbacks: { title: (items) => modoSemana ? items[0].label : `Dia ${items[0].label}` } },
      },
      scales: {
        x: { title: { display: true, text: modoSemana ? "data" : "dia do mês", font: { size: 10 } }, ticks: { font: { size: 9 } } },
        y: { title: { display: true, text: "kg", font: { size: 10 } }, ticks: { font: { size: 9 } } },
      },
    },
  });
}

// fonte e cor dos textos dos gráficos no padrão visual dos apps da Prime
if (window.Chart) {
  Chart.defaults.font.family = '"Segoe UI", Arial, sans-serif';
  Chart.defaults.color = "#4a6a8f";
}

document.addEventListener("DOMContentLoaded", async () => {
  renderRelogio();
  await Promise.all([carregarResumoHoje(), carregarMetaMensalCompartilhada(), carregarHistoricoMensalCompartilhado()]);
  renderPainel();
  setInterval(renderRelogio, 1000);
  setInterval(async () => {
    // busca o resumo de tempo real, a meta mensal e o histórico publicados
    // pelos outros apps
    await Promise.all([carregarResumoHoje(), carregarMetaMensalCompartilhada(), carregarHistoricoMensalCompartilhado()]);
    renderPainel();
    atualizarPeriodoSeAberto();
  }, 60000);
  configurarBotaoInstalar();
  configurarPeriodo();
  configurarMeta();
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

// Mostra o botão "Instalar app" só quando o navegador confirma que dá pra
// instalar (Chrome/Edge/Android) -- sem isso, a opção de instalar fica
// escondida num menu que quase ninguém acha sozinho.
let deferredInstallPrompt = null;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  const btn = document.getElementById("btn-instalar-app");
  if (btn) btn.classList.remove("hidden");
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  const btn = document.getElementById("btn-instalar-app");
  if (btn) btn.classList.add("hidden");
});
function configurarBotaoInstalar() {
  const btn = document.getElementById("btn-instalar-app");
  if (!btn) return;
  btn.addEventListener("click", async () => {
    if (!deferredInstallPrompt) return;
    deferredInstallPrompt.prompt();
    await deferredInstallPrompt.userChoice;
    deferredInstallPrompt = null;
    btn.classList.add("hidden");
  });
}
