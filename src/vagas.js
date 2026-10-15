/* ============================================================================
   vagas.js — distribuição de vagas em eleições proporcionais.

   Módulo puro: não toca em DOM, rede nem relógio. Roda no navegador
   (window.Vagas) e no Node (require). Recebe um quadro neutro de votos e
   devolve quociente eleitoral, vagas por partido (ou federação) e eleitos.

   Regras codificadas (Código Eleitoral, Lei 4.737/1965, na redação da
   Lei 14.211/2021):
     art. 106  quociente eleitoral: votos válidos ÷ vagas; fração até 0,5
               é desprezada, acima de 0,5 arredonda para cima;
     art. 107  quociente partidário: votos do partido ÷ QE, sem fração;
     art. 108  só são eleitos, pelo quociente, candidatos com votação
               nominal de pelo menos 10% do QE, na ordem dos votos;
     art. 109  sobras: maior média (votos ÷ vagas já obtidas + 1), só entre
               partidos com pelo menos 80% do QE e candidato com pelo menos
               20% do QE; depois, se ainda sobrar vaga, a disputa se abre a
               todos os partidos (STF, ADIs 7228, 7263 e 7325);
     art. 111  se nenhum partido alcança o QE, vencem os mais votados.
   A federação de partidos conta como um partido só.

   Toda comparação com percentuais usa aritmética de inteiros (sem ponto
   flutuante), para que 10%, 20% e 80% do QE sejam exatos.

   Quadro de entrada (base):
     {
       vagas: 30,                    // cadeiras em disputa
       vv: 6217229,                  // votos válidos (nominais + legenda)
       partidos: [
         { id: '100', nome: 'Federação X',
           votos: 812345,            // nominais + legenda do partido
           cands: [ { n: '1001', nome: '…', votos: 5400,
                      valido: true,  // false: voto anulado ou sub judice
                      nasc: 19800101 // AAAAMMDD, só para desempate
                    }, … ] }
       ]
     }
   ============================================================================ */
(function (raiz, fabrica) {
  'use strict';
  if (typeof module === 'object' && module.exports) { module.exports = fabrica(); }
  else { raiz.Vagas = fabrica(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  /** Fases pelas quais uma vaga pode ser conquistada. */
  const FASE = { QP: 'QP', MEDIA: 'média', TERCEIRA: '3ª fase', MAIS_VOTADOS: 'mais votados' };

  /** Art. 106: quociente eleitoral, em inteiros (fração > 1/2 sobe). */
  function quociente(votosValidos, vagas) {
    if (!votosValidos || !vagas) { return 0; }
    const q = Math.floor(votosValidos / vagas);
    const resto = votosValidos - q * vagas;
    return 2 * resto > vagas ? q + 1 : q;
  }

  /** Ordem dos candidatos: mais votos primeiro; empate, o mais velho (nasc menor). */
  function ordemCand(a, b) {
    return (b.votos - a.votos) || ((a.nasc === undefined ? 0 : a.nasc) - (b.nasc === undefined ? 0 : b.nasc));
  }

  /**
   * Distribui `vagas` cadeiras entre os partidos e, se pedido, mais `extra`
   * posições de fila (quem levaria as vagas seguintes pela mesma conta).
   */
  function distribuir(partidos, votosValidos, vagas, extra) {
    extra = extra || 0;
    const qe = quociente(votosValidos, vagas);
    const P = partidos.map(function (p) {
      const ordem = p.cands.filter(function (c) { return c.valido !== false; }).sort(ordemCand);
      return { p: p, votos: p.votos, ordem: ordem, lug: 0, qp: 0, vQP: 0, vMed: 0, v3: 0, vMv: 0, vagas: 0 };
    });
    const res = { qe: qe, vv: votosValidos, vagas: vagas, P: P, eleitos: [], fila: [] };
    if (!qe) { return res; }
    const total = vagas + extra;

    function eleger(x, fase, candidato) {
      const c = candidato || x.ordem[x.lug];
      x.lug++;
      const reg = { c: c, x: x, fase: fase };
      if (res.eleitos.length < vagas) {
        res.eleitos.push(reg);
        x.vagas++;
        if (fase === FASE.QP) { x.vQP++; }
        else if (fase === FASE.MEDIA) { x.vMed++; }
        else if (fase === FASE.MAIS_VOTADOS) { x.vMv++; }
        else { x.v3++; }
      } else {
        res.fila.push(reg);
      }
    }

    /** Partido apto com a maior média (votos ÷ (lugares+1)); empate: mais votos. */
    function maiorMedia(apto) {
      let melhor = null;
      P.forEach(function (x) {
        if (!apto(x)) { return; }
        if (!melhor) { melhor = x; return; }
        // x.votos/(x.lug+1) contra melhor.votos/(melhor.lug+1), por multiplicação cruzada
        const esq = x.votos * (melhor.lug + 1);
        const dir = melhor.votos * (x.lug + 1);
        if (esq > dir || (esq === dir && x.votos > melhor.votos)) { melhor = x; }
      });
      return melhor;
    }

    // art. 111: nenhum partido alcançou o quociente eleitoral
    if (!P.some(function (x) { return x.votos >= qe; })) {
      const todos = [];
      P.forEach(function (x) { x.ordem.forEach(function (c) { todos.push({ c: c, x: x }); }); });
      todos.sort(function (a, b) { return ordemCand(a.c, b.c); });
      todos.slice(0, total).forEach(function (t) { eleger(t.x, FASE.MAIS_VOTADOS, t.c); });
      return res;
    }

    // 1ª fase (arts. 107 e 108): quociente partidário, só candidatos com 10% do QE
    P.forEach(function (x) {
      x.qp = Math.floor(x.votos / qe);
      let aptos = 0;
      while (aptos < x.ordem.length && 10 * x.ordem[aptos].votos >= qe) { aptos++; }
      const k = Math.min(x.qp, aptos);
      for (let i = 0; i < k; i++) { eleger(x, FASE.QP); }
    });

    // 2ª fase (art. 109): maiores médias entre partidos com 80% do QE e candidato com 20%
    let lugares = res.eleitos.length + res.fila.length;
    while (lugares < total) {
      const x2 = maiorMedia(function (x) {
        const c = x.ordem[x.lug];
        return 5 * x.votos >= 4 * qe && !!c && 5 * c.votos >= qe;
      });
      if (!x2) { break; }
      eleger(x2, FASE.MEDIA);
      lugares++;
    }

    // 3ª fase (art. 109, §2º, com a leitura do STF): maiores médias entre todos
    while (lugares < total) {
      const x3 = maiorMedia(function (x) { return !!x.ordem[x.lug]; });
      if (!x3) { break; }
      eleger(x3, FASE.TERCEIRA);
      lugares++;
    }
    return res;
  }

  /* ----------------------------------------------------------- consultas */
  function xDe(res, pid) {
    for (let i = 0; i < res.P.length; i++) { if (res.P[i].p.id === pid) { return res.P[i]; } }
    return null;
  }
  function vagasDe(res, pid) { const x = xDe(res, pid); return x ? x.vagas : 0; }
  function eleitoNa(res, n) {
    for (let i = 0; i < res.eleitos.length; i++) { if (res.eleitos[i].c.n === n) { return res.eleitos[i]; } }
    return null;
  }
  /** Posição do candidato na fila (1 = próximo a entrar) ou 0 se não está nela. */
  function naFila(res, n) {
    for (let i = 0; i < res.fila.length; i++) { if (res.fila[i].c.n === n) { return i + 1; } }
    return 0;
  }

  /* ---------------------------------------------------------- simulações */
  /** Refaz a conta com `delta` votos a mais (ou a menos) para um candidato; ele soma ao partido e ao total. */
  function simularCandidato(base, n, delta) {
    const ps = base.partidos.map(function (p) {
      const i = p.cands.findIndex(function (c) { return c.n === n; });
      if (i < 0) { return p; }
      const cands = p.cands.slice();
      const c = Object.assign({}, cands[i]);
      const aplicado = Math.max(0, c.votos + delta) - c.votos;
      c.votos += aplicado;
      cands[i] = c;
      cands.sort(ordemCand);
      return Object.assign({}, p, { votos: p.votos + aplicado, cands: cands });
    });
    return distribuir(ps, base.vv + delta, base.vagas, 0);
  }
  /** Refaz a conta com `delta` votos a mais (ou a menos) no total de um partido (por exemplo, na legenda). */
  function simularPartido(base, pid, delta) {
    const ps = base.partidos.map(function (p) {
      return p.id === pid ? Object.assign({}, p, { votos: Math.max(0, p.votos + delta) }) : p;
    });
    return distribuir(ps, base.vv + delta, base.vagas, 0);
  }

  /** Menor valor inteiro v >= 1 com teste(v) verdadeiro, buscando sem teto (dobra até achar). null se não achar. */
  function menorAberto(teste, inicio) {
    let lo = 0, hi = Math.max(1, inicio), voltas = 0;
    while (!teste(hi)) { lo = hi; hi *= 2; if (++voltas > 40) { return null; } }
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (teste(m)) { hi = m; } else { lo = m; } }
    return hi;
  }
  /** Menor valor inteiro v em [1, max] com teste(v) verdadeiro, supondo teste monotônico. null se nem max serve. */
  function menorAte(teste, max) {
    if (max < 1 || !teste(max)) { return null; }
    let lo = 0, hi = max;
    while (hi - lo > 1) { const m = Math.floor((lo + hi) / 2); if (teste(m)) { hi = m; } else { lo = m; } }
    return hi;
  }

  /**
   * A conta de um candidato: se está dentro da projeção, quantos votos a menos
   * o tirariam; se está fora, quantos a mais o colocariam. Os votos dos outros
   * ficam como estão. Devolve { dentro, perde } ou { dentro, falta }.
   */
  function contaCandidato(base, res, n) {
    const reg = eleitoNa(res, n);
    let cand = null;
    base.partidos.forEach(function (p) { p.cands.forEach(function (c) { if (c.n === n) { cand = c; } }); });
    if (!cand || !res.qe) { return null; }
    if (reg) {
      return { dentro: true, perde: menorAte(function (v) { return !eleitoNa(simularCandidato(base, n, -v), n); }, cand.votos) };
    }
    return { dentro: false, falta: menorAberto(function (v) { return !!eleitoNa(simularCandidato(base, n, v), n); }, 500) };
  }

  /**
   * Margens de um partido: votos a mais no primeiro suplente para ganhar mais
   * uma vaga (`ganha`) e votos a menos no total do partido para perder uma (`perde`).
   */
  function margensPartido(base, res, pid) {
    const x0 = xDe(res, pid);
    if (!x0 || !x0.votos || !res.qe) { return {}; }
    const k = x0.vagas, prox = x0.ordem[x0.vagas];
    const sim = prox
      ? function (v) { return simularCandidato(base, prox.n, v); }
      : function (v) { return simularPartido(base, pid, v); };
    return {
      k: k,
      ganha: menorAberto(function (v) { return vagasDe(sim(v), pid) > k; }, Math.max(100, Math.round(res.qe / 4))),
      perde: k > 0 ? menorAte(function (v) { return vagasDe(simularPartido(base, pid, -v), pid) < k; }, x0.votos) : null
    };
  }

  return {
    FASE: FASE,
    quociente: quociente,
    ordemCand: ordemCand,
    distribuir: distribuir,
    xDe: xDe,
    vagasDe: vagasDe,
    eleitoNa: eleitoNa,
    naFila: naFila,
    simularCandidato: simularCandidato,
    simularPartido: simularPartido,
    contaCandidato: contaCandidato,
    margensPartido: margensPartido
  };
});
