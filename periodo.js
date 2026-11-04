/* Painel de Produção — "Produção anterior" e ajuste da meta mensal.
 * Depende de telao.js (carregado antes): historicoMensalCompartilhado,
 * entradaDoDia, mergePapeis, mergeClientes, fmt, isDiaUtil, MESES_PT,
 * DIAS_SEMANA_PT, loadMetaMensal, META_MENSAL_KEY, metaMensalCompartilhada.
 *
 * Tudo vem do histórico mensal compartilhado (historico-mensal.json); nada é
 * digitado nem carregado à mão.
 */

let periodoSelecionado = "semana-atual"; // "semana-atual" | "semana-passada" | "mes-passado" | "AAAA-MM"
let periodoChart = null;

// ---------------------------------------------------------------- DATAS --
function isoDeData(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function segundaDaSemana(d) {
  // semana de segunda a domingo
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() - ((d.getDay() + 6) % 7));
}
function listarDias(ini, fim) {
  const dias = [];
  for (let d = new Date(ini); d <= fim; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
    dias.push(new Date(d));
  }
  return dias;
}
function ddmm(d) {
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

// Intervalo [ini, fim] e título de cada opção do seletor.
function intervaloDoPeriodo(tipo) {
  const hoje = new Date();
  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  if (tipo === "semana-atual") {
    const ini = segundaDaSemana(hoje0);
    const fim = new Date(ini.getFullYear(), ini.getMonth(), ini.getDate() + 6);
    return { ini, fim, titulo: `Semana atual — ${ddmm(ini)} a ${ddmm(fim)}`, semana: true };
  }
  if (tipo === "semana-passada") {
    const seg = segundaDaSemana(hoje0);
    const ini = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() - 7);
    const fim = new Date(seg.getFullYear(), seg.getMonth(), seg.getDate() - 1);
    return { ini, fim, titulo: `Semana passada — ${ddmm(ini)} a ${ddmm(fim)}`, semana: true };
  }
  let ano, mesIdx;
  if (tipo === "mes-passado") {
    const m = new Date(hoje0.getFullYear(), hoje0.getMonth() - 1, 1);
    ano = m.getFullYear(); mesIdx = m.getMonth();
  } else {
    ano = parseInt(tipo.slice(0, 4), 10); mesIdx = parseInt(tipo.slice(5, 7), 10) - 1;
  }
  const ini = new Date(ano, mesIdx, 1);
  const fim = new Date(ano, mesIdx + 1, 0);
  const nome = `${MESES_PT[mesIdx]} de ${ano}`;
  const parcial = fim > hoje0 ? " (até hoje)" : "";
  return { ini, fim, titulo: `${tipo === "mes-passado" ? "Mês passado — " : ""}${nome}${parcial}`, semana: false };
}

// ------------------------------------------------------------- CÁLCULO ---
function calcularPeriodo(tipo) {
  const { ini, fim, titulo, semana } = intervaloDoPeriodo(tipo);
  const hoje = new Date();
  const hoje0 = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  const dias = listarDias(ini, fim).map((d) => {
    const entry = entradaDoDia(isoDeData(d));
    const total = (entry && entry.total) || {};
    return {
      data: d,
      label: semana
        ? `${["dom", "seg", "ter", "qua", "qui", "sex", "sáb"][d.getDay()]} ${ddmm(d)}`
        : String(d.getDate()),
      futuro: d > hoje0,
      util: isDiaUtil(d.getFullYear(), d.getMonth(), d.getDate()),
      temEntrada: !!entry,
      peso: total.peso || 0,
      chapas: total.chapas || 0,
      pesoDia: (entry && entry.dia && entry.dia.peso) || 0,
      pesoNoite: (entry && entry.noite && entry.noite.peso) || 0,
      papeis: total.papeis || [],
      clientes: total.clientes || [],
    };
  });

  const comProducao = dias.filter((x) => x.peso > 0);
  const pesoTotal = dias.reduce((s, x) => s + x.peso, 0);
  const chapasTotal = dias.reduce((s, x) => s + x.chapas, 0);
  const melhor = comProducao.reduce((m, x) => (!m || x.peso > m.peso ? x : m), null);
  return {
    titulo, semana, dias,
    pesoTotal, chapasTotal,
    pesoDia: dias.reduce((s, x) => s + x.pesoDia, 0),
    pesoNoite: dias.reduce((s, x) => s + x.pesoNoite, 0),
    diasComProducao: comProducao.length,
    diasUteisComProducao: comProducao.filter((x) => x.util).length,
    diasUteisNoPeriodo: dias.filter((x) => x.util && !x.futuro).length,
    mediaPorDia: comProducao.length ? pesoTotal / comProducao.length : 0,
    melhor,
    papeis: mergePapeis(...dias.map((x) => x.papeis)),
    clientes: mergeClientes(...dias.map((x) => x.clientes)),
  };
}

// -------------------------------------------------------------- RENDER ---
function tabelaRanking(titulo, chave, lista, pesoTotal, max) {
  const linhas = lista.slice(0, max).map((x) => {
    const pct = pesoTotal > 0 ? (x.peso / pesoTotal) * 100 : 0;
    return `<tr><td>${x[chave]}</td><td class="num">${fmt(x.chapas)}</td><td class="num">${fmt(x.peso)}</td><td class="num">${fmt(pct, 1)}%</td></tr>`;
  }).join("");
  const resto = lista.length - max;
  return `<table class="per-tabela">
    <thead><tr><th>${titulo}</th><th class="num">Chapas</th><th class="num">kg</th><th class="num">%</th></tr></thead>
    <tbody>${linhas || '<tr><td colspan="4">—</td></tr>'}</tbody>
    ${resto > 0 ? `<tfoot><tr><td colspan="4">+ ${resto} outro(s)</td></tr></tfoot>` : ""}
  </table>`;
}

function renderPeriodo() {
  const r = calcularPeriodo(periodoSelecionado);

  // botões / seletor
  document.querySelectorAll("#per-botoes .per-btn").forEach((b) => {
    b.classList.toggle("ativo", b.dataset.per === periodoSelecionado);
  });
  const sel = document.getElementById("per-mes");
  const ehMesEscolhido = /^\d{4}-\d{2}$/.test(periodoSelecionado);
  sel.classList.toggle("ativo", ehMesEscolhido);
  sel.value = ehMesEscolhido ? periodoSelecionado : "";

  document.getElementById("per-titulo").textContent = r.titulo;

  const vazio = r.diasComProducao === 0;
  document.getElementById("per-vazio").classList.toggle("hidden", !vazio);
  document.getElementById("per-conteudo").classList.toggle("hidden", vazio);
  if (vazio) {
    if (periodoChart) { periodoChart.destroy(); periodoChart = null; }
    return;
  }

  const kpis = [
    { rotulo: "PRODUZIDO", valor: `${fmt(r.pesoTotal)} <small>kg</small>`, sub: `${fmt(r.pesoTotal / 1000, 1)} toneladas` },
    { rotulo: "CHAPAS", valor: fmt(r.chapasTotal), sub: "total do período" },
    { rotulo: "DIAS COM PRODUÇÃO", valor: String(r.diasComProducao), sub: `${r.diasUteisComProducao} de ${r.diasUteisNoPeriodo} dias úteis` },
    { rotulo: "MÉDIA POR DIA PRODUZIDO", valor: `${fmt(r.mediaPorDia)} <small>kg</small>`, sub: r.melhor ? `melhor dia: ${ddmm(r.melhor.data)} · ${fmt(r.melhor.peso)} kg` : "—" },
    { rotulo: "TURNO DIA × NOITE", valor: `${fmt(r.pesoDia)} <small>×</small> ${fmt(r.pesoNoite)}`, sub: "kg no turno dia × kg no turno noite" },
  ];
  document.getElementById("per-kpis").innerHTML = kpis.map((k) =>
    `<div class="per-kpi"><div class="per-kpi-rotulo">${k.rotulo}</div><div class="per-kpi-valor">${k.valor}</div><div class="per-kpi-sub">${k.sub}</div></div>`
  ).join("");

  document.getElementById("per-papeis").innerHTML = tabelaRanking("Papel", "papel", r.papeis, r.pesoTotal, 10);
  document.getElementById("per-clientes").innerHTML = tabelaRanking("Cliente", "cliente", r.clientes, r.pesoTotal, 10);

  // gráfico de barras por dia
  const cores = r.dias.map((x) => {
    if (x.futuro || x.peso <= 0) return "#D9D9D9";
    return x.util ? "#2E75B6" : "#1BAF7A"; // verde = fim de semana (bônus)
  });
  const dados = r.dias.map((x) => (x.futuro ? null : Math.round(x.peso)));
  const ctx = document.getElementById("per-chart");
  if (periodoChart) periodoChart.destroy();
  periodoChart = new Chart(ctx, {
    type: "bar",
    data: {
      labels: r.dias.map((x) => x.label),
      datasets: [{ label: "Produzido (kg)", data: dados, backgroundColor: cores, borderRadius: 3 }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { display: false },
        tooltip: { callbacks: { label: (i) => ` ${fmt(i.parsed.y)} kg` } },
      },
      scales: {
        x: { title: { display: true, text: r.semana ? "dia" : "dia do mês", font: { size: 11 } }, ticks: { font: { size: 11 } } },
        y: { title: { display: true, text: "kg", font: { size: 11 } }, ticks: { font: { size: 11 } }, beginAtZero: true },
      },
    },
  });
}

function preencherSeletorDeMeses() {
  const sel = document.getElementById("per-mes");
  const hojeRef = isoDeData(new Date()).slice(0, 7);
  const meses = Object.keys(historicoMensalCompartilhado)
    .filter((m) => /^\d{4}-\d{2}$/.test(m))
    .sort()
    .reverse();
  const atual = sel.value;
  sel.innerHTML = '<option value="">Outro mês…</option>' + meses.map((m) => {
    const nome = `${MESES_PT[parseInt(m.slice(5, 7), 10) - 1]} de ${m.slice(0, 4)}`;
    return `<option value="${m}">${nome}${m === hojeRef ? " (atual)" : ""}</option>`;
  }).join("");
  sel.value = atual;
}

function abrirPeriodo() {
  preencherSeletorDeMeses();
  document.getElementById("modal-periodo").classList.remove("hidden");
  renderPeriodo();
}
function fecharPeriodo() {
  document.getElementById("modal-periodo").classList.add("hidden");
  if (periodoChart) { periodoChart.destroy(); periodoChart = null; }
}
function atualizarPeriodoSeAberto() {
  if (document.getElementById("modal-periodo").classList.contains("hidden")) return;
  preencherSeletorDeMeses();
  renderPeriodo();
}

function configurarPeriodo() {
  document.getElementById("btn-periodo").addEventListener("click", abrirPeriodo);
  document.getElementById("per-fechar").addEventListener("click", fecharPeriodo);
  document.getElementById("modal-periodo").addEventListener("click", (e) => {
    if (e.target.id === "modal-periodo") fecharPeriodo();
  });
  document.querySelectorAll("#per-botoes .per-btn").forEach((b) => {
    b.addEventListener("click", () => { periodoSelecionado = b.dataset.per; renderPeriodo(); });
  });
  document.getElementById("per-mes").addEventListener("change", (e) => {
    if (e.target.value) { periodoSelecionado = e.target.value; renderPeriodo(); }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { fecharPeriodo(); fecharMeta(); }
  });
}

// ------------------------------------------------------- META MENSAL -----
// Única configuração que sobrou no app. Protegida pela mesma senha da antiga
// tela de upload. A meta é publicada no servidor (webhook meta-mensal) e
// todas as telas passam a mostrar o mesmo valor.
const SENHA_META = "0907";
const META_MENSAL_WEBHOOK_URL = "https://n8n.mcamargo.uk/webhook/meta-mensal";

function fecharMeta() {
  document.getElementById("modal-meta").classList.add("hidden");
}

function configurarMeta() {
  const modal = document.getElementById("modal-meta");
  const senha = document.getElementById("meta-senha");
  const valor = document.getElementById("meta-valor");
  const msg = document.getElementById("meta-msg");
  const passoSenha = document.getElementById("meta-passo-senha");
  const passoMeta = document.getElementById("meta-passo-meta");

  document.getElementById("btn-meta").addEventListener("click", () => {
    senha.value = ""; msg.textContent = "";
    passoSenha.classList.remove("hidden");
    passoMeta.classList.add("hidden");
    modal.classList.remove("hidden");
    senha.focus();
  });
  document.getElementById("meta-fechar").addEventListener("click", fecharMeta);
  modal.addEventListener("click", (e) => { if (e.target === modal) fecharMeta(); });

  const entrar = () => {
    if (senha.value !== SENHA_META) {
      msg.textContent = "Senha incorreta.";
      senha.value = ""; senha.focus();
      return;
    }
    msg.textContent = "";
    passoSenha.classList.add("hidden");
    passoMeta.classList.remove("hidden");
    valor.value = Math.round(loadMetaMensal());
    valor.focus();
  };
  document.getElementById("meta-entrar").addEventListener("click", entrar);
  senha.addEventListener("keydown", (e) => { if (e.key === "Enter") entrar(); });

  const salvar = async () => {
    const v = parseFloat(valor.value);
    if (isNaN(v) || v <= 0) { msg.textContent = "Digite uma meta válida (kg)."; return; }
    try { localStorage.setItem(META_MENSAL_KEY, String(v)); } catch (e) { /* ignore */ }
    metaMensalCompartilhada = v;
    metaLocalValidaAte = Date.now() + 15 * 60 * 1000;
    renderPainel();
    msg.textContent = "Salvando…";
    try {
      await fetch(META_MENSAL_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ metaMensal: v }),
        keepalive: true,
      });
      msg.textContent = "✓ Meta salva e publicada.";
    } catch (e) {
      msg.textContent = "Salva só neste aparelho (sem conexão com o servidor).";
    }
    setTimeout(fecharMeta, 1500);
  };
  document.getElementById("meta-salvar").addEventListener("click", salvar);
  valor.addEventListener("keydown", (e) => { if (e.key === "Enter") salvar(); });
}
