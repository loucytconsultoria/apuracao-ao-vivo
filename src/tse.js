/* ============================================================================
   tse.js — leitura dos arquivos públicos de divulgação de resultados do TSE.

   O TSE publica, para cada eleição, cargo e UF (ou município), um JSON
   atualizado a cada totalização. O servidor libera CORS para qualquer origem,
   então o navegador lê direto, sem backend.

   Este módulo só traduz esse JSON para o quadro neutro que src/vagas.js usa.
   Roda no navegador (window.TSE) e no Node (require).

   Formato lido (campos usados):
     idg, dg, hg, and        id, data, hora da totalização; and = 'f' encerrada
     s.ts, s.st, s.pst       seções totais, totalizadas, % totalizado
     v.vv                    votos válidos
     carg[0].nv, .qe         vagas e quociente eleitoral informado pelo TSE
     carg[0].agr[]           partidos ou federações (tp 'f' = federação)
       .par[]                partidos da agremiação: tvtn (votos nominais
                             válidos), tvtl (legenda), sg (sigla)
         .cand[]             n, nm/nmu, dt (nascimento), dvt (destino do voto),
                             vap (votos), pvapn (% válidos), st (situação), e
   ============================================================================ */
(function (raiz, fabrica) {
  'use strict';
  if (typeof module === 'object' && module.exports) { module.exports = fabrica(); }
  else { raiz.TSE = fabrica(); }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const RAIZ = 'https://resultados.tse.jus.br/oficial/';

  function int(s) { const n = parseInt(s, 10); return isNaN(n) ? 0 : n; }
  function num(s) {
    const n = parseFloat(String(s === null || s === undefined ? '0' : s).replace(',', '.'));
    return isNaN(n) ? 0 : n;
  }
  function zeros(v, n) { v = String(v); while (v.length < n) { v = '0' + v; } return v; }
  /** '25/03/1960' -> 19600325; sem data, um número alto (fica por último no desempate). */
  function dataNum(s) {
    const m = /(\d{2})\/(\d{2})\/(\d{4})/.exec(s || '');
    return m ? +(m[3] + m[2] + m[1]) : 99999999;
  }

  /**
   * Endereço do arquivo de resultados.
   *   ano      2026 · eleicao  6259 (código da eleição no ciclo) · uf 'pr'
   *   cargo    6 (dep. federal), 7 (dep. estadual), 13 (vereador)…
   *   mun      código TSE do município (eleições municipais); vazio = UF inteira
   */
  function urlResultado(o) {
    const uf = String(o.uf).toLowerCase();
    const arq = uf + (o.mun || '') + '-c' + zeros(o.cargo, 4) + '-e' + zeros(o.eleicao, 6) + '-u.json';
    return RAIZ + 'ele' + o.ano + '/' + o.eleicao + '/dados/' + uf + '/' + arq;
  }

  function nomeAgremiacao(a) {
    if (a.tp === 'f') { return 'Federação ' + String(a.com || a.nm).replace(/\s*\/\s*/g, '/'); }
    return String(a.com || a.nm);
  }

  /**
   * Traduz o JSON do TSE para o quadro de src/vagas.js. Devolve null se o
   * arquivo não tem o cargo. Além de { vagas, vv, partidos }, leva dados de
   * exibição: qeTSE, apuracao { pct, secoesTotalizadas, secoes, data, hora, id, encerrada }.
   */
  function montarBase(d) {
    const cg = d && d.carg && d.carg[0];
    if (!cg) { return null; }
    const partidos = (cg.agr || []).map(function (a) {
      const cands = [];
      let votos = 0, legenda = 0;
      const siglas = [];
      (a.par || []).forEach(function (p) {
        votos += int(p.tvtn) + int(p.tvtl);
        legenda += int(p.tvtl);
        siglas.push(p.sg);
        (p.cand || []).forEach(function (c) {
          cands.push({
            n: String(c.n),
            nome: String(c.nmu || c.nm).trim(),
            sg: p.sg,
            votos: int(c.vap),
            pct: num(c.pvapn || c.pvap),
            nasc: dataNum(c.dt),
            valido: !c.dvt || c.dvt === 'Válido',
            dvt: c.dvt || '',
            st: c.st || '',
            eleitoTSE: c.e === 's'
          });
        });
      });
      cands.sort(function (x, y) { return (y.votos - x.votos) || (x.nasc - y.nasc); });
      return {
        id: String(a.n), nome: nomeAgremiacao(a), tipo: a.tp, siglas: siglas,
        votos: votos, legenda: legenda, vagasTSE: int(a.vag), cands: cands
      };
    });
    const s = d.s || {};
    return {
      vagas: int(cg.nv),
      vv: int(d.v && d.v.vv),
      qeTSE: int(cg.qe),
      cargo: cg.nmn || '',
      partidos: partidos,
      apuracao: {
        pct: num(s.pstn || s.pst), secoesTotalizadas: int(s.st), secoes: int(s.ts),
        data: d.dg || '', hora: d.hg || '', id: d.idg, encerrada: d.and === 'f'
      }
    };
  }

  /** Lê um endereço e devolve o JSON (rejeita se o TSE não responder 200). */
  function ler(url, fetchFn) {
    const f = fetchFn || (typeof fetch === 'function' ? fetch : null);
    if (!f) { return Promise.reject(new Error('fetch indisponível')); }
    return f(url, { cache: 'no-cache', credentials: 'omit' }).then(function (r) {
      if (!r.ok) { throw new Error('o servidor respondeu ' + r.status); }
      return r.json();
    });
  }

  return { RAIZ: RAIZ, urlResultado: urlResultado, montarBase: montarBase, ler: ler, int: int, num: num };
});
