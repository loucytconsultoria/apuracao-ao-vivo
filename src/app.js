/* ============================================================================
   app.js — a tela. Lê o arquivo de resultados (TSE ou demonstração) a cada N
   segundos, monta o quadro com src/tse.js, calcula com src/vagas.js e desenha.
   Sem framework, sem backend, sem build.
   ============================================================================ */
(function () {
  'use strict';

  const CFG = window.APURACAO_CONFIG || {};
  const Q = new URLSearchParams(location.search);
  const DEMO = Q.get('demo') === '1';
  const FILA = 5;               // quantas posições de fila mostrar além das vagas
  const PADRAO = CFG.padrao || { ano: 2026, eleicao: 6259, uf: 'pr', cargo: 6, mun: '' };
  const DEMO_CFG = CFG.demo || { arquivos: [], intervaloSegundos: 5 };
  const SEG = DEMO ? (DEMO_CFG.intervaloSegundos || 5) : (CFG.intervaloSegundos || 30);

  function param(nome, padrao) { return Q.has(nome) ? Q.get(nome) : padrao; }

  /* ------------------------------------------------------------ parâmetros */
  const alvo = {
    ano: parseInt(param('ano', PADRAO.ano), 10),
    eleicao: parseInt(param('eleicao', PADRAO.eleicao), 10),
    uf: String(param('uf', PADRAO.uf)).toLowerCase(),
    cargo: parseInt(param('cargo', PADRAO.cargo), 10),
    mun: String(param('mun', PADRAO.mun || ''))
  };
  const focoCfg = DEMO ? { numero: DEMO_CFG.numero, partido: DEMO_CFG.partido } : (CFG.foco || {});
  let numeroFoco = String(param('numero', focoCfg.numero || '')).replace(/\D/g, '');
  let partidoFoco = String(param('partido', focoCfg.partido || ''));

  /* ------------------------------------------------------------- utilidades */
  const fmtInt = function (n) { return Math.round(n).toLocaleString('pt-BR'); };
  const fmtDec = function (n, c) { return n.toLocaleString('pt-BR', { minimumFractionDigits: c, maximumFractionDigits: c }); };
  const fmtPct = function (n, c) { return fmtDec(n, c === undefined ? 2 : c) + '%'; };
  const VAZIO = '—';
  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function titulo(s) {
    return String(s).toLowerCase().replace(/(^|\s|-)(\S)/g, function (m, a, b) { return a + b.toUpperCase(); })
      .replace(/\b(De|Da|Do|Dos|Das|E)\b/g, function (m) { return m.toLowerCase(); });
  }
  function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase(); }
  function plural(n, um, varios) { return n === 1 ? um : varios; }
  const $ = function (id) { return document.getElementById(id); };

  /* ----------------------------------------------------------------- estado */
  const S = { d: null, base: null, res: null, idg: null, lido: null, erro: null, prox: 0, timer: null, demoIdx: 0, hist: [], cand: {}, todos: [], abertos: {}, busca: '' };

  function urlAtual() {
    if (DEMO) {
      const arqs = DEMO_CFG.arquivos;
      return arqs[Math.min(S.demoIdx, arqs.length - 1)];
    }
    return TSE.urlResultado(alvo);
  }

  /* ------------------------------------------------------------ ciclo de leitura */
  function ciclo() {
    clearTimeout(S.timer);
    return TSE.ler(urlAtual()).then(function (d) {
      S.lido = new Date(); S.erro = null;
      if (DEMO && S.demoIdx < DEMO_CFG.arquivos.length - 1) { S.demoIdx++; }
      if (d.idg !== S.idg || !S.base) { S.d = d; S.idg = d.idg; processar(); desenhar(); }
    }).catch(function (e) {
      S.erro = e;
      if (!S.base) { desenhar(); }
    }).then(function () {
      S.prox = Date.now() + SEG * 1000;
      S.timer = setTimeout(ciclo, SEG * 1000);
      vivo();
    });
  }

  function processar() {
    S.base = TSE.montarBase(S.d);
    if (!S.base) { S.res = null; return; }
    S.res = Vagas.distribuir(S.base.partidos, S.base.vv, S.base.vagas, FILA);
    S.cand = {}; S.todos = [];
    S.base.partidos.forEach(function (p) {
      p.cands.forEach(function (c) { S.cand[c.n] = { c: c, p: p }; S.todos.push(c); });
    });
    S.conta = undefined;
    registrar();
  }

  /* ------------------------------------------------------------------ foco */
  function partidoPorTexto(txt) {
    if (!txt || !S.base) { return null; }
    const t = semAcento(txt.trim());
    return S.base.partidos.filter(function (p) {
      return p.id === txt.trim() || semAcento(p.nome).indexOf(t) >= 0 || p.siglas.some(function (s) { return semAcento(s) === t; });
    })[0] || null;
  }
  function focoAtual() {
    const cand = numeroFoco ? S.cand[numeroFoco] || null : null;
    const partido = cand ? cand.p : partidoPorTexto(partidoFoco);
    return { numero: numeroFoco, cand: cand, partido: partido };
  }
  function nomeCand(c) { return titulo(c.nome); }

  /** Situação do candidato: votos, posições e projeção. */
  function situacao(n) {
    const x = S.cand[n];
    if (!x) { return null; }
    let posGeral = 1, posPartido = 1;
    S.todos.forEach(function (o) { if (o.votos > x.c.votos) { posGeral++; } });
    x.p.cands.forEach(function (o) { if (o.votos > x.c.votos) { posPartido++; } });
    return {
      c: x.c, p: x.p, posGeral: posGeral, totalGeral: S.todos.length, posPartido: posPartido, totalPartido: x.p.cands.length,
      eleito: Vagas.eleitoNa(S.res, n), fila: Vagas.naFila(S.res, n), vagasPartido: Vagas.vagasDe(S.res, x.p.id)
    };
  }

  /* --------------------------------------------------------------- histórico */
  function chaveFoco() { const f = focoAtual(); return f.cand ? 'c' + f.cand.c.n : (f.partido ? 'p' + f.partido.id : ''); }
  function registrar() {
    const a = S.base.apuracao;
    if (a.pct <= 0 || !S.res.qe) { return; }
    const f = focoAtual();
    if (!f.cand && !f.partido) { return; }
    const ultimo = S.hist[S.hist.length - 1];
    if (ultimo && ultimo.id === a.id) { return; }
    const x = f.partido ? Vagas.xDe(S.res, f.partido.id) : null;
    S.hist.push({
      id: a.id, chave: chaveFoco(), pct: a.pct, hora: a.hora,
      votos: f.cand ? f.cand.c.votos : (f.partido ? f.partido.votos : 0),
      pctValidos: f.cand ? f.cand.c.pct : (S.base.vv ? 100 * f.partido.votos / S.base.vv : 0),
      vagas: x ? x.vagas : 0
    });
  }

  /* ------------------------------------------------------------- componentes */
  function chipFase(f) {
    const cls = f === 'QP' ? 'qp' : f === 'média' ? 'media' : f === 'fila' ? 'fila' : 'f3';
    const txt = f === 'QP' ? 'quociente' : f;
    return '<span class="fase fase-' + cls + '">' + esc(txt) + '</span>';
  }
  function chipTSE(st) {
    if (!st) { return '<span class="chip">sem indicação</span>'; }
    const cls = /^Eleito/.test(st) ? 'bom' : /Suplente/.test(st) ? 'atencao' : /Não eleito/.test(st) ? 'ruim' : '';
    return '<span class="chip ' + cls + '">' + esc(st) + '</span>';
  }
  function projTxt(si) {
    if (!si || !S.res.qe) { return '<span class="chip">aguardando votos</span>'; }
    if (si.eleito) { return '<span class="chip bom">eleito</span> ' + chipFase(si.eleito.fase); }
    if (si.fila) { return '<span class="chip atencao">fora, ' + si.fila + 'º da fila</span>'; }
    return '<span class="chip ruim">fora</span>';
  }
  function numero(rot, valor, nota, cls) {
    return '<div class="num ' + (cls || '') + '"><span class="num-rot">' + rot + '</span><b class="num-val">' + valor + '</b><span class="num-nota">' + (nota || '') + '</span></div>';
  }
  function caixa(titulo_, conteudo, id) {
    return '<section class="caixa"' + (id ? ' id="' + id + '"' : '') + '><h2>' + titulo_ + '</h2>' + conteudo + '</section>';
  }
  function tabela(cab, linhas, rodape) {
    let h = '<div class="rola"><table><thead><tr>' + cab.map(function (c) { return '<th>' + c + '</th>'; }).join('') + '</tr></thead><tbody>';
    linhas.forEach(function (l) {
      const cls = Array.isArray(l) ? '' : l.classe, cels = Array.isArray(l) ? l : l.cels;
      h += '<tr' + (cls ? ' class="' + cls + '"' : '') + '>' + cels.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr>';
    });
    h += '</tbody>';
    if (rodape) { h += '<tfoot><tr>' + rodape.map(function (c) { return '<td>' + c + '</td>'; }).join('') + '</tr></tfoot>'; }
    return h + '</table></div>';
  }

  /* ------------------------------------------------------------------ blocos */
  function blocoApurado() {
    const a = S.base.apuracao;
    return caixa('Andamento da apuração',
      '<div class="apurado"><b>' + fmtPct(a.pct) + '</b><span>das seções totalizadas</span><span class="peq">' + fmtInt(a.secoesTotalizadas) + ' de ' + fmtInt(a.secoes) + ' seções</span></div>' +
      '<div class="barra"><i style="width:' + Math.min(100, a.pct) + '%"></i></div>' +
      '<p class="nota">Última totalização: ' + esc(a.data) + ' às ' + esc(a.hora) + (a.encerrada ? ' · apuração encerrada' : '') + '. ' +
      esc(S.base.cargo) + ': ' + S.base.vagas + ' vagas.</p>');
  }

  function blocoKpis(f) {
    if (!f.numero) { return ''; }
    const si = f.cand ? situacao(f.numero) : null;
    if (!si) { return '<p class="aviso">O número ' + esc(f.numero) + ' não está no arquivo deste cargo.</p>'; }
    const comecou = S.base.apuracao.secoesTotalizadas > 0;
    return '<div class="numeros">' +
      numero('Votos de ' + esc(nomeCand(si.c)), fmtInt(si.c.votos), fmtPct(si.c.pct) + ' dos votos válidos', 'destaque') +
      numero('Posição geral', comecou ? si.posGeral + 'º' : VAZIO, 'de ' + fmtInt(si.totalGeral) + ' candidatos') +
      numero('Posição no partido', comecou ? si.posPartido + 'º' : VAZIO, 'de ' + si.totalPartido + ' · ' + esc(si.p.nome)) +
      numero('Na projeção', projTxt(si), si.eleito ? (si.eleito.fase === 'QP' ? 'pelo quociente partidário' : 'pelas sobras') : (si.fila ? 'seria a ' + (S.base.vagas + si.fila) + 'ª vaga' : ''), 'medio') +
      numero('Situação no TSE', chipTSE(si.c.st), si.c.dvt && si.c.dvt !== 'Válido' ? 'votos: ' + esc(si.c.dvt) : '', 'medio') +
      numero('Vagas do partido', S.res.qe ? String(si.vagasPartido) : VAZIO, S.res.qe ? fmtDec(Vagas.xDe(S.res, si.p.id).votos / S.res.qe, 2) + ' quocientes' : 'aguardando votos') +
      '</div>';
  }

  function blocoConta(f) {
    if (!f.cand) { return ''; }
    const si = situacao(f.numero);
    if (!S.res.qe) { return caixa('A conta de ' + esc(nomeCand(si.c)), '<p class="vazio">Aguardando os primeiros votos totalizados.</p>'); }
    const c = si.c, x = Vagas.xDe(S.res, si.p.id);
    const ct = Vagas.contaCandidato(S.base, S.res, c.n);
    const quem = esc(nomeCand(c));
    const linhas = [];
    if (ct.dentro) {
      linhas.push('<b>' + quem + ' está eleito na projeção</b> (' + (si.eleito.fase === 'QP' ? 'quociente partidário' : 'sobras, ' + si.eleito.fase) + '). ' +
        (ct.perde !== null ? 'Sairia com <b>' + fmtInt(ct.perde) + '</b> votos a menos, mantidos os votos dos outros.' : ''));
    } else {
      linhas.push('<b>' + quem + ' está fora na projeção.</b> ' +
        (ct.falta !== null ? 'Faltam <b>' + fmtInt(ct.falta) + '</b> votos para entrar, mantidos os votos dos outros (esses votos também somam para o partido).' : ''));
    }
    const cs = si.p.cands, i = cs.indexOf(c), viz = [];
    if (i > 0) { viz.push('acima: ' + esc(nomeCand(cs[i - 1])) + ', com ' + fmtInt(cs[i - 1].votos) + ' (' + fmtInt(cs[i - 1].votos - c.votos) + ' a mais)'); }
    if (i < cs.length - 1) { viz.push('abaixo: ' + esc(nomeCand(cs[i + 1])) + ', com ' + fmtInt(cs[i + 1].votos) + ' (' + fmtInt(c.votos - cs[i + 1].votos) + ' a menos)'); }
    if (viz.length) { linhas.push('No partido, ' + (i + 1) + 'º lugar; ' + viz.join('; ') + '.'); }
    const m = Vagas.margensPartido(S.base, S.res, si.p.id);
    let t = esc(si.p.nome) + ' tem <b>' + x.vagas + ' ' + plural(x.vagas, 'vaga', 'vagas') + '</b> na projeção';
    if (x.vagas) {
      t += ' (' + [x.vQP ? x.vQP + ' pelo quociente' : '', x.vMed ? x.vMed + ' pela média' : '', x.v3 ? x.v3 + ' na 3ª fase' : ''].filter(Boolean).join(', ') + ')';
    }
    t += ', com ' + fmtDec(x.votos / S.res.qe, 2) + ' quocientes.';
    if (m.ganha !== null && m.ganha !== undefined) { t += ' Ganharia mais uma com <b>' + fmtInt(m.ganha) + '</b> votos a mais no primeiro suplente.'; }
    if (m.perde !== null && m.perde !== undefined) { t += ' Perderia uma com ' + fmtInt(m.perde) + ' votos a menos.'; }
    linhas.push(t);
    return caixa('A conta de ' + quem + ' agora', '<div class="conta">' + linhas.map(function (l) { return '<p>' + l + '</p>'; }).join('') + '</div>');
  }

  function blocoQE() {
    const qe = S.res.qe;
    let h = '<div class="numeros">' +
      numero('Votos válidos', fmtInt(S.base.vv), 'nominais + legenda, apurados até agora') +
      numero('Vagas', String(S.base.vagas), '') +
      numero('Quociente eleitoral', qe ? fmtInt(qe) : VAZIO, 'válidos ÷ vagas') +
      numero('10% do QE', qe ? fmtInt(Math.ceil(qe / 10)) : VAZIO, 'mínimo do candidato para vaga pelo quociente') +
      numero('20% do QE', qe ? fmtInt(Math.ceil(qe / 5)) : VAZIO, 'mínimo do candidato nas sobras (2ª fase)') +
      numero('80% do QE', qe ? fmtInt(Math.ceil(qe * 4 / 5)) : VAZIO, 'mínimo do partido nas sobras (2ª fase)') + '</div>';
    let obs = 'QE = votos válidos ÷ ' + S.base.vagas + ', desprezada a fração até meio.';
    if (S.base.qeTSE) {
      obs += ' QE informado pelo TSE: ' + fmtInt(S.base.qeTSE) + (S.base.qeTSE === qe ? ' (igual ao calculado).' : ' (diferente do calculado aqui; vale o do TSE).');
    }
    return caixa('Quociente eleitoral em tempo real', h + '<p class="nota">' + obs + '</p>');
  }

  function blocoVagas(f) {
    const qe = S.res.qe, vv = S.base.vv;
    const temTSE = S.base.partidos.some(function (p) { return p.vagasTSE > 0; });
    const lst = S.res.P.slice().sort(function (a, b) { return b.votos - a.votos || b.vagas - a.vagas; });
    const tot = { votos: 0, qp: 0, med: 0, f3: 0, vagas: 0, tse: 0 };
    const linhas = lst.map(function (x) {
      tot.votos += x.votos; tot.qp += x.vQP; tot.med += x.vMed; tot.f3 += x.v3 + x.vMv; tot.vagas += x.vagas; tot.tse += x.p.vagasTSE;
      const cels = [esc(x.p.nome), fmtInt(x.votos), vv ? fmtPct(100 * x.votos / vv, 2) : VAZIO,
        qe ? fmtDec(x.votos / qe, 2) + (5 * x.votos < 4 * qe ? ' <small>&lt;80%</small>' : '') : VAZIO,
        x.vQP || '', x.vMed || '', (x.v3 + x.vMv) || '', '<b>' + (qe ? x.vagas : VAZIO) + '</b>'];
      if (temTSE) { cels.push(String(x.p.vagasTSE)); }
      cels.push('<span data-ganha="' + esc(x.p.id) + '">' + VAZIO + '</span>', '<span data-perde="' + esc(x.p.id) + '">' + VAZIO + '</span>');
      return { classe: f.partido && x.p.id === f.partido.id ? 'foco' : '', cels: cels };
    });
    const cab = ['Partido ou federação', 'Votos', '% válidos', 'Quocientes', 'QP', 'Média', '3ª fase', 'Vagas'];
    if (temTSE) { cab.push('TSE'); }
    cab.push('+1 vaga', 'Perde 1');
    const rod = ['Total', fmtInt(tot.votos), '', '', String(tot.qp), String(tot.med), String(tot.f3), String(tot.vagas)];
    if (temTSE) { rod.push(String(tot.tse)); }
    rod.push('', '');
    return caixa('Distribuição das ' + S.base.vagas + ' vagas na projeção', tabela(cab, linhas, rod) +
      '<p class="nota">QP: vagas pelo quociente partidário (candidato com pelo menos 10% do QE). Média: sobras para o partido com 80% do QE e candidato com 20%. ' +
      '3ª fase: sobras restantes, abertas a todos. "+1 vaga": votos a mais no primeiro suplente para o partido ganhar mais uma cadeira. ' +
      '"Perde 1": votos a menos no total do partido para perder a última. Os outros partidos ficam como estão. A coluna TSE aparece quando o arquivo já traz as vagas proclamadas.</p>');
  }

  /** Preenche +1 vaga / Perde 1 aos poucos, para a tela aparecer antes da conta pesada. */
  function preencherMargens() {
    const idg = S.idg, ordem = S.res.P.filter(function (x) { return x.votos > 0; });
    let i = 0;
    (function passo() {
      if (S.idg !== idg || i >= ordem.length || !S.res.qe) { return; }
      const x = ordem[i++], m = Vagas.margensPartido(S.base, S.res, x.p.id);
      const g = document.querySelector('[data-ganha="' + x.p.id + '"]'), p = document.querySelector('[data-perde="' + x.p.id + '"]');
      if (g) { g.textContent = m.ganha !== null && m.ganha !== undefined ? fmtInt(m.ganha) : VAZIO; }
      if (p) { p.textContent = m.perde !== null && m.perde !== undefined ? fmtInt(m.perde) : VAZIO; }
      setTimeout(passo, 0);
    })();
  }

  function linhaCand(c, x, fase, extra) {
    const foco = numeroFoco && c.n === numeroFoco;
    return { classe: (foco ? 'foco ' : '') + (extra || ''), cels: [
      esc(nomeCand(c)) + ' <small>' + esc(c.n) + '</small>', esc(x.p.tipo === 'f' ? c.sg : x.p.nome), fmtInt(c.votos), fase ? chipFase(fase) : ''] };
  }
  function blocoEleitos() {
    if (!S.res.qe) { return caixa('Eleitos na projeção', '<p class="vazio">Aguardando votos.</p>'); }
    const el = S.res.eleitos.slice().sort(function (a, b) { return Vagas.ordemCand(a.c, b.c); });
    const linhas = el.map(function (e, i) { return linhaCand(e.c, e.x, e.fase, i === el.length - 1 ? 'corte' : ''); });
    S.res.fila.forEach(function (fl) { linhas.push(linhaCand(fl.c, fl.x, 'fila', 'fila')); });
    return caixa('Eleitos na projeção', tabela(['Candidato', 'Partido', 'Votos', 'Fase'], linhas) +
      '<p class="nota">Abaixo da linha tracejada, a fila: quem levaria as próximas vagas, pela mesma conta.</p>');
  }

  function fraseProj(n) {
    const e = Vagas.eleitoNa(S.res, n);
    if (e) { return e.fase; }
    return Vagas.naFila(S.res, n) ? 'fila' : '';
  }
  function tabelaPartido(p) {
    const qe = S.res.qe, x = Vagas.xDe(S.res, p.id), k = x ? x.vagas : 0;
    const linhas = p.cands.map(function (c, i) {
      let marcas = '';
      if (!c.valido) { marcas = ' <small>' + esc(c.dvt) + '</small>'; }
      else if (qe && 10 * c.votos < qe) { marcas = ' <small>&lt;10%</small>'; }
      else if (qe && 5 * c.votos < qe) { marcas = ' <small>&lt;20%</small>'; }
      const fase = fraseProj(c.n);
      const cels = [String(i + 1), esc(nomeCand(c)) + ' <small>' + esc(c.n) + '</small>'];
      if (p.tipo === 'f') { cels.push(esc(c.sg)); }
      cels.push(fmtInt(c.votos) + marcas, fmtPct(c.pct), fase ? chipFase(fase) : '', '<small>' + esc(c.st) + '</small>');
      return { classe: (numeroFoco && c.n === numeroFoco ? 'foco ' : '') + (k > 0 && i === k - 1 ? 'corte' : ''), cels: cels };
    });
    const cab = ['#', 'Candidato'];
    if (p.tipo === 'f') { cab.push('Partido'); }
    cab.push('Votos', '% válidos', 'Projeção', 'TSE');
    return tabela(cab, linhas);
  }
  function blocoPartidoFoco(f) {
    if (!f.partido) { return ''; }
    return caixa(esc(f.partido.nome), tabelaPartido(f.partido) +
      '<p class="nota">Linha tracejada: última vaga do partido na projeção. &lt;10% e &lt;20%: abaixo do mínimo do candidato para o quociente e para as sobras.</p>');
  }

  function blocoTodos() {
    const lista = S.res.P.slice().sort(function (a, b) { return b.votos - a.votos; }).map(function (x) {
      const aberto = S.abertos[x.p.id];
      return '<details class="partido" data-pid="' + esc(x.p.id) + '"' + (aberto ? ' open' : '') + '><summary><b>' + esc(x.p.nome) + '</b> <span class="peq">' +
        fmtInt(x.votos) + ' votos · ' + x.p.cands.length + ' candidatos' + (S.res.qe ? ' · ' + x.vagas + ' ' + plural(x.vagas, 'vaga', 'vagas') + ' na projeção' : '') +
        '</span></summary><div class="conteudo">' + (aberto ? tabelaPartido(x.p) : '') + '</div></details>';
    }).join('');
    return caixa('Todos os candidatos, por partido',
      '<div class="campo"><label for="busca">Buscar candidato por nome ou número</label><input type="search" id="busca" value="' + esc(S.busca) + '" autocomplete="off"></div>' +
      '<div id="busca-res"></div><div>' + lista + '</div>');
  }
  function buscaHtml() {
    const q = semAcento(S.busca.trim());
    if (!q) { return ''; }
    const achados = [];
    S.res.P.forEach(function (x) {
      x.p.cands.forEach(function (c) { if (semAcento(c.nome).indexOf(q) >= 0 || c.n.indexOf(q) === 0) { achados.push({ c: c, x: x }); } });
    });
    achados.sort(function (a, b) { return Vagas.ordemCand(a.c, b.c); });
    if (!achados.length) { return '<p class="vazio">Nenhum candidato com esse nome ou número.</p>'; }
    return tabela(['Candidato', 'Partido', 'Votos', 'Projeção'], achados.slice(0, 60).map(function (a) { return linhaCand(a.c, a.x, fraseProj(a.c.n)); }));
  }

  /* ------------------------------------------------------------- gráficos */
  function passoEixo(x) {
    if (x <= 0) { return 1; }
    const e = Math.pow(10, Math.floor(Math.log(x) / Math.LN10)), f = x / e;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * e;
  }
  function grafico(titulo_, pts, fmt) {
    const W = 600, H = 220, ml = 58, mr = 16, mt = 14, mb = 28;
    let g = '<figure><figcaption>' + titulo_ + '</figcaption><svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="' + esc(titulo_) + '">';
    if (!pts.length) {
      return g + '<text class="eixo" x="' + W / 2 + '" y="' + H / 2 + '" text-anchor="middle">Começa quando a primeira seção for totalizada</text></svg></figure>';
    }
    let ymax = 0; pts.forEach(function (p) { ymax = Math.max(ymax, p.y); });
    const st = passoEixo((ymax || 1) / 4); ymax = st * Math.max(1, Math.ceil((ymax || 1) / st));
    const X = function (v) { return ml + (W - ml - mr) * v / 100; };
    const Y = function (v) { return H - mb - (H - mt - mb) * v / ymax; };
    for (let v = 0; v <= ymax + 1e-9; v += st) {
      g += '<line class="grade" x1="' + ml + '" x2="' + (W - mr) + '" y1="' + Y(v) + '" y2="' + Y(v) + '"/><text class="eixo" x="' + (ml - 8) + '" y="' + (Y(v) + 4) + '" text-anchor="end">' + fmt(v) + '</text>';
    }
    [0, 25, 50, 75, 100].forEach(function (t) { g += '<text class="eixo" x="' + X(t) + '" y="' + (H - 8) + '" text-anchor="middle">' + t + '%</text>'; });
    g += '<path class="linha" d="' + pts.map(function (p, i) { return (i ? 'L' : 'M') + X(p.x).toFixed(1) + ',' + Y(p.y).toFixed(1); }).join('') + '"/>';
    pts.forEach(function (p) {
      g += '<circle class="ponto" cx="' + X(p.x).toFixed(1) + '" cy="' + Y(p.y).toFixed(1) + '" r="4"><title>' + esc(fmt(p.y, true)) + ' · ' + fmtPct(p.x) + ' apurado · ' + esc(p.h) + '</title></circle>';
    });
    return g + '</svg></figure>';
  }
  function blocoEvolucao(f) {
    if (!f.cand && !f.partido) { return ''; }
    const chave = chaveFoco(), nome = f.cand ? nomeCand(f.cand.c) : f.partido.nome;
    const hs = S.hist.filter(function (p) { return p.chave === chave; });
    const serie = function (campo) { return hs.map(function (p) { return { x: p.pct, y: p[campo], h: p.hora }; }); };
    const fVotos = function (v, cheio) { return cheio ? fmtInt(v) + ' votos' : (v >= 1000 ? fmtDec(v / 1000, v % 1000 ? 1 : 0) + ' mil' : fmtInt(v)); };
    const fPct = function (v, cheio) { return fmtPct(v, cheio ? 2 : (v < 1 ? 2 : 1)); };
    const fVag = function (v, cheio) { return cheio ? fmtInt(v) + ' ' + plural(v, 'vaga', 'vagas') : (v % 1 ? '' : fmtInt(v)); };
    return caixa('Evolução de ' + esc(nome) + ' durante a apuração',
      '<div class="graficos">' + grafico('Votos', serie('votos'), fVotos) + grafico('% dos votos válidos', serie('pctValidos'), fPct) +
      grafico('Vagas do partido na projeção', serie('vagas'), fVag) + '</div>' +
      '<p class="nota">Eixo horizontal: % das seções totalizadas. O histórico vale enquanto a página ficar aberta.</p>');
  }

  function blocoMetodo() {
    return '<details class="caixa metodo"><summary><h2>Como a conta é feita</h2></summary><ul>' +
      '<li>Os números vêm dos arquivos públicos de divulgação do TSE, lidos pelo navegador a cada ' + SEG + ' segundos. Nenhum servidor nosso participa.</li>' +
      '<li>Quociente eleitoral (QE): votos válidos (nominais + legenda) ÷ vagas, desprezada a fração até meio. Quociente partidário: votos do partido ÷ QE, sem a fração. Federação conta como um partido.</li>' +
      '<li>1ª fase: cada partido elege tantos quantos o quociente partidário indicar, entre os candidatos com pelo menos 10% do QE, na ordem dos votos.</li>' +
      '<li>2ª fase (sobras): maior média (votos do partido ÷ vagas já obtidas + 1) entre os partidos com 80% do QE e candidato com 20%.</li>' +
      '<li>3ª fase: o que sobrar vai pela maior média entre todos os partidos e candidatos (STF, ADIs 7228, 7263 e 7325). Se nenhum partido alcança o QE, entram os mais votados (art. 111).</li>' +
      '<li>Empate de média: o partido com mais votos. Empate de candidato: o mais velho.</li>' +
      '<li>Votos de candidato com registro anulado ou sub judice ficam fora da conta, como o TSE informa no arquivo.</li>' +
      '<li>É conta sobre votos parciais: a ordem em que as urnas chegam muda o quadro. O resultado é o que o TSE proclamar.</li></ul>' +
      '<p class="nota">A conta foi conferida com as eleições de vereador de 2024 dos 399 municípios do Paraná: mesmos eleitos, mesma fase e mesmas vagas por partido que o TSE proclamou (3.905 cadeiras, 29 delas na 3ª fase). ' +
      'A página <a href="validacao/index.html">validacao/</a> refaz a conferência no navegador e <a href="tests/tests.html">tests/tests.html</a> roda os testes.</p></details>';
  }

  /* ------------------------------------------------------------ desenho geral */
  function atualizarSeletores() {
    const sp = $('sel-partido');
    if (S.base && sp.options.length <= 1) {
      S.base.partidos.slice().sort(function (a, b) { return b.votos - a.votos; }).forEach(function (p) {
        const o = document.createElement('option'); o.value = p.id; o.textContent = p.nome; sp.appendChild(o);
      });
    }
    const f = focoAtual();
    if (S.base) { sp.value = f.partido ? f.partido.id : ''; sp.disabled = !!f.cand; }
    $('in-numero').value = numeroFoco;
  }

  function desenhar() {
    const alvoEl = $('corpo');
    if (!S.base || !S.res) {
      alvoEl.innerHTML = S.erro
        ? '<p class="erro">Não consegui ler os resultados (' + esc(S.erro.message) + '). Fora do período de apuração os arquivos do TSE podem não estar no ar. ' +
          'Tente de novo em ' + SEG + ' s ou abra a <a href="?demo=1">demonstração com dados sintéticos</a>.</p>'
        : '<p class="vazio">Lendo os resultados…</p>';
      return;
    }
    atualizarSeletores();
    const f = focoAtual();
    const rolagem = window.scrollY, ativo = document.activeElement && document.activeElement.id === 'busca';
    let h = blocoApurado();
    if (S.base.apuracao.secoesTotalizadas === 0) {
      h += '<p class="aviso">A apuração ainda não começou: nenhuma seção totalizada. A tela se atualiza sozinha.</p>';
    }
    h += blocoKpis(f) + blocoConta(f) + blocoQE() + blocoVagas(f);
    h += '<div class="duas">' + blocoEleitos() + blocoPartidoFoco(f) + '</div>';
    h += blocoEvolucao(f) + blocoTodos() + blocoMetodo();
    alvoEl.innerHTML = h;
    ligarCorpo(alvoEl);
    preencherMargens();
    if (ativo) { const b = $('busca'); if (b) { b.focus(); b.setSelectionRange(b.value.length, b.value.length); } }
    if (Math.abs(window.scrollY - rolagem) > 2) { window.scrollTo(0, rolagem); }
  }

  function ligarCorpo(raiz) {
    Array.prototype.forEach.call(raiz.querySelectorAll('details.partido'), function (d) {
      d.addEventListener('toggle', function () {
        const pid = d.getAttribute('data-pid');
        S.abertos[pid] = d.open;
        if (d.open) { d.querySelector('.conteudo').innerHTML = tabelaPartido(Vagas.xDe(S.res, pid).p); }
      });
    });
    const b = $('busca');
    if (b) {
      const res = $('busca-res');
      res.innerHTML = buscaHtml();
      b.addEventListener('input', function () { S.busca = b.value; res.innerHTML = buscaHtml(); });
    }
  }

  function vivo() {
    const el = $('vivo');
    if (S.erro) {
      el.className = 'vivo erro-txt';
      el.textContent = 'Sem resposta (' + S.erro.message + ')' + (S.lido ? '; última leitura às ' + S.lido.toLocaleTimeString('pt-BR') : '') + '. Nova tentativa em breve.';
      return;
    }
    el.className = 'vivo';
    if (!S.lido) { el.textContent = 'Conectando…'; return; }
    const falta = Math.max(0, Math.round((S.prox - Date.now()) / 1000));
    el.textContent = (DEMO ? 'Demonstração lida às ' : 'Resultados lidos às ') + S.lido.toLocaleTimeString('pt-BR') + ' · próxima leitura em ' + falta + ' s';
  }

  /* --------------------------------------------------------------- controles */
  function irPara(novos) {
    const p = new URLSearchParams(location.search);
    Object.keys(novos).forEach(function (k) { if (novos[k] === '' || novos[k] === null) { p.delete(k); } else { p.set(k, novos[k]); } });
    return '?' + p.toString();
  }
  function iniciarControles() {
    const sel = $('sel-eleicao');
    if (DEMO) {
      sel.innerHTML = '<option>' + esc(DEMO_CFG.rotulo || 'Demonstração') + '</option>';
      sel.disabled = true;
      const av = $('aviso-demo');
      av.hidden = false;
      av.innerHTML = 'Modo demonstração: dados sintéticos de um estado fictício, no mesmo formato do TSE. A cada leitura a apuração avança (18%, 46%, 78%, 100%). ' +
        '<a href="' + esc(irPara({ demo: '' })) + '">Abrir com dados do TSE</a> · <a href="">Reiniciar</a>';
    } else {
      const lista = (CFG.eleicoes || []).slice();
      let atual = lista.findIndex(function (e) { return e.ano === alvo.ano && e.eleicao === alvo.eleicao && e.uf === alvo.uf && e.cargo === alvo.cargo && String(e.mun || '') === alvo.mun; });
      if (atual < 0) { lista.push({ rotulo: 'Personalizada (' + alvo.uf.toUpperCase() + ' ' + alvo.ano + ', cargo ' + alvo.cargo + ')', ano: alvo.ano, eleicao: alvo.eleicao, uf: alvo.uf, cargo: alvo.cargo, mun: alvo.mun }); atual = lista.length - 1; }
      sel.innerHTML = lista.map(function (e, i) { return '<option value="' + i + '">' + esc(e.rotulo) + '</option>'; }).join('');
      sel.value = String(atual);
      sel.addEventListener('change', function () {
        const e = lista[+sel.value];
        location.search = '?' + new URLSearchParams({ ano: e.ano, eleicao: e.eleicao, uf: e.uf, cargo: e.cargo, mun: e.mun || '' }).toString();
      });
    }
    $('controles').addEventListener('submit', function (ev) { ev.preventDefault(); });
    $('in-numero').addEventListener('change', function () {
      numeroFoco = this.value.replace(/\D/g, '');
      if (numeroFoco) { partidoFoco = ''; }
      history.replaceState(null, '', irPara({ numero: numeroFoco, partido: partidoFoco }));
      S.hist = [];
      if (S.base) { registrar(); desenhar(); }
    });
    $('sel-partido').addEventListener('change', function () {
      partidoFoco = this.value;
      history.replaceState(null, '', irPara({ partido: partidoFoco }));
      S.hist = [];
      if (S.base) { registrar(); desenhar(); }
    });
    $('bt-ler').addEventListener('click', function () { ciclo(); });
    setInterval(vivo, 1000);
  }

  iniciarControles();
  ciclo();
})();
