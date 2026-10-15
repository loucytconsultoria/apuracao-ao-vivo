/* Casos de teste de src/vagas.js. Sem dependências: cada teste é uma função que lança erro se falhar.
   Carregado por tests.html; também roda em Node se um dia houver (module.exports.rodar). */
(function (raiz) {
  'use strict';

  /** Monta um partido sintético a partir de votos por candidato (já em ordem decrescente). */
  function partido(id, votosCands, extra) {
    extra = extra || {};
    const cands = votosCands.map(function (v, i) {
      return { n: id + String(i + 1), nome: 'Candidato ' + id + (i + 1), votos: v, valido: true, nasc: 19800101 + i };
    });
    const nominais = votosCands.reduce(function (a, b) { return a + b; }, 0);
    return { id: id, nome: 'Partido ' + id, votos: extra.votos !== undefined ? extra.votos : nominais + (extra.legenda || 0), cands: cands };
  }
  function base(vagas, partidos) {
    return { vagas: vagas, vv: partidos.reduce(function (a, p) { return a + p.votos; }, 0), partidos: partidos };
  }
  function vagasPor(res) {
    const o = {};
    res.P.forEach(function (x) { o[x.p.id] = x.vagas; });
    return o;
  }
  function igual(real, esperado, msg) {
    const a = JSON.stringify(real), b = JSON.stringify(esperado);
    if (a !== b) { throw new Error((msg ? msg + ': ' : '') + 'esperado ' + b + ', veio ' + a); }
  }
  function verdade(cond, msg) { if (!cond) { throw new Error(msg || 'condição falsa'); } }

  /** Gerador pseudoaleatório com semente (mulberry32), para os testes de propriedade serem reproduzíveis. */
  function semente(a) {
    return function () {
      a |= 0; a = a + 0x6D2B79F5 | 0;
      let t = Math.imul(a ^ a >>> 15, 1 | a);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }

  function montarTestes(V) {
    const T = [];
    const t = function (nome, fn) { T.push({ nome: nome, fn: fn }); };

    /* ---------------------------------------------------- quociente eleitoral */
    t('quociente: fração até meio é desprezada, acima de meio sobe', function () {
      igual(V.quociente(100, 3), 33, '100/3 = 33,33');
      igual(V.quociente(101, 2), 50, '101/2 = 50,5 (meio exato é desprezado)');
      igual(V.quociente(103, 2), 51, '103/2 = 51,5');
      igual(V.quociente(1001, 3), 334, '1001/3 = 333,67');
      igual(V.quociente(1000, 8), 125, 'divisão exata');
    });
    t('quociente: sem votos ou sem vagas dá zero', function () {
      igual(V.quociente(0, 10), 0);
      igual(V.quociente(1000, 0), 0);
    });

    /* ------------------------------------------------------ fases da distribuição */
    t('1ª fase e 2ª fase: quociente partidário e maior média (empate de média vai a quem tem mais votos)', function () {
      // QE = 1000/5 = 200. QP: A 3, B 1, C 0. A 5ª vaga: A 600/4 = 150 contra B 300/2 = 150; empate, A tem mais votos.
      const b = base(5, [partido('A', [250, 200, 100, 50]), partido('B', [200, 100]), partido('C', [100])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(r.qe, 200);
      igual(vagasPor(r), { A: 4, B: 1, C: 0 });
      const fa = V.xDe(r, 'A');
      igual([fa.vQP, fa.vMed, fa.v3], [3, 1, 0]);
    });

    t('regra dos 10%: candidato abaixo de 10% do QE não ocupa vaga do quociente', function () {
      // QE = 1000/4 = 250. A tem 600 votos (QP = 2), mas só o 1º candidato passa de 25 votos (10% do QE).
      // A fica com 1 vaga pelo quociente; as outras duas saem pela média, e A não é apto (seu próximo candidato
      // tem 20 votos, menos de 20% do QE).
      const b = base(4, [partido('A', [570, 20, 10]), partido('B', [200, 100, 50]), partido('C', [50])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(r.qe, 250);
      igual(V.xDe(r, 'A').qp, 2, 'A teria direito a 2 pelo quociente');
      igual(V.xDe(r, 'A').vQP, 1, 'mas só elege 1, por falta de candidato com 10% do QE');
      igual(vagasPor(r), { A: 1, B: 3, C: 0 });
    });

    t('candidato com votos anulados (valido: false) fica fora da conta', function () {
      // O 1º de A tem o voto anulado: não entra no partido (400 votos válidos) nem pode ser eleito.
      const a = partido('A', [500, 300, 100], { votos: 400 });
      a.cands[0].valido = false;
      const b = base(2, [a, partido('B', [400, 100])]); // vv = 900, QE = 450
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(r.qe, 450);
      verdade(!V.eleitoNa(r, 'A1'), 'o candidato com voto anulado não pode ser eleito');
      verdade(V.eleitoNa(r, 'A2'), 'o seguinte da lista ocupa a vaga de A');
    });

    t('3ª fase aberta a todos: sobra vai por média mesmo sem 80% do QE ou 20% do QE', function () {
      // QE = 870/3 = 290. QP: A 1 (480 votos), B 1 (300). Na 2ª fase ninguém é apto: o próximo de A tem 40 e o de B tem 50
      // (menos que 20% do QE = 58), e C tem 90 votos (menos que 80% do QE = 232).
      const b = base(3, [partido('A', [400, 40, 40]), partido('B', [200, 50, 50]), partido('C', [90])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(r.qe, 290);
      igual(vagasPor(r), { A: 2, B: 1, C: 0 });
      const xa = V.xDe(r, 'A');
      igual([xa.vQP, xa.vMed, xa.v3], [1, 0, 1], 'a vaga extra de A sai na 3ª fase');
    });

    t('art. 111: se nenhum partido alcança o quociente, elegem-se os mais votados', function () {
      // QE = 1000/2 = 500; nenhum partido chega a 500.
      const b = base(2, [partido('A', [250, 150]), partido('B', [200, 100]), partido('C', [180, 120])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(r.qe, 500);
      igual(r.eleitos.map(function (e) { return e.c.n; }), ['A1', 'B1']);
      igual(r.eleitos.map(function (e) { return e.fase; }), ['mais votados', 'mais votados']);
    });

    t('sem votos: tudo zerado, ninguém eleito', function () {
      const b = base(5, [partido('A', [0, 0]), partido('B', [0])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(r.qe, 0);
      igual(r.eleitos.length, 0);
    });

    t('fila: com extra, mostra quem levaria as vagas seguintes, em ordem', function () {
      const b = base(5, [partido('A', [250, 200, 100, 50, 40]), partido('B', [200, 100]), partido('C', [100])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 3);
      igual(r.eleitos.length, 5);
      igual(r.fila.length, 3);
      igual(V.naFila(r, r.fila[0].c.n), 1);
      igual(V.naFila(r, 'zzz'), 0);
    });

    t('federação conta como um partido só (votos somados, um quociente partidário)', function () {
      // dois partidos federados entram como UM partido com a lista conjunta
      const fed = { id: 'F', nome: 'Federação', votos: 600, cands: [
        { n: 'F1', nome: 'x', votos: 250, valido: true, nasc: 1 }, { n: 'F2', nome: 'y', votos: 200, valido: true, nasc: 2 },
        { n: 'F3', nome: 'z', votos: 100, valido: true, nasc: 3 }, { n: 'F4', nome: 'w', votos: 50, valido: true, nasc: 4 }] };
      const b = base(5, [fed, partido('B', [200, 100]), partido('C', [100])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      igual(V.xDe(r, 'F').qp, 3, 'quociente partidário da federação');
      igual(vagasPor(r).F, 4);
    });

    /* --------------------------------------------------------------- simulações */
    t('contaCandidato: a margem é exata (um voto a menos não basta; o número exato basta)', function () {
      const b = base(5, [partido('A', [250, 200, 100, 50]), partido('B', [200, 100]), partido('C', [100, 90, 80])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 3);
      // um candidato eleito: quantos votos a menos o tiram?
      const dentro = r.eleitos[r.eleitos.length - 1].c.n;
      const cd = V.contaCandidato(b, r, dentro);
      verdade(cd.dentro && cd.perde > 0, 'candidato dentro deve ter margem');
      verdade(!V.eleitoNa(V.simularCandidato(b, dentro, -cd.perde), dentro), 'com a margem exata ele sai');
      verdade(V.eleitoNa(V.simularCandidato(b, dentro, -(cd.perde - 1)), dentro), 'um voto a menos que a margem, ele fica');
      // um candidato fora: quantos votos a mais o colocam?
      const fora = r.fila[0].c.n;
      const cf = V.contaCandidato(b, r, fora);
      verdade(!cf.dentro && cf.falta > 0, 'candidato fora deve ter falta');
      verdade(V.eleitoNa(V.simularCandidato(b, fora, cf.falta), fora), 'com os votos que faltam ele entra');
      verdade(!V.eleitoNa(V.simularCandidato(b, fora, cf.falta - 1), fora), 'um voto a menos que o necessário, não entra');
    });

    t('margensPartido: "+1 vaga" ganha uma cadeira e "perde 1" tira uma, sem exagero', function () {
      const b = base(5, [partido('A', [250, 200, 100, 50]), partido('B', [200, 100]), partido('C', [100, 90, 80])]);
      const r = V.distribuir(b.partidos, b.vv, b.vagas, 0);
      const m = V.margensPartido(b, r, 'B');
      verdade(m.perde > 0, 'B tem uma vaga e pode perdê-la');
      igual(V.vagasDe(V.simularPartido(b, 'B', -m.perde), 'B'), m.k - 1, 'com a margem exata B perde uma');
      igual(V.vagasDe(V.simularPartido(b, 'B', -(m.perde - 1)), 'B'), m.k, 'um voto antes disso, B mantém');
    });

    /* -------------------------------------------------- propriedades (aleatório) */
    t('propriedades em 300 cenários sintéticos: vagas, unicidade e ordem dos eleitos', function () {
      const rnd = semente(2026);
      for (let k = 0; k < 300; k++) {
        const vagas = 3 + Math.floor(rnd() * 28);
        const np = 2 + Math.floor(rnd() * 9);
        const ps = [];
        for (let i = 0; i < np; i++) {
          const nc = 1 + Math.floor(rnd() * (vagas + 4));
          const base_ = Math.floor(rnd() * 90000);
          const vs = [];
          for (let j = 0; j < nc; j++) { vs.push(Math.floor(base_ / (j + 1) * (0.6 + rnd() * 0.8))); }
          vs.sort(function (a, b) { return b - a; });
          ps.push(partido('P' + i, vs, { legenda: Math.floor(rnd() * 3000) }));
        }
        const b = base(vagas, ps);
        const r = V.distribuir(b.partidos, b.vv, b.vagas, 4);
        const disponiveis = ps.reduce(function (a, p) { return a + p.cands.length; }, 0);
        igual(r.eleitos.length, Math.min(vagas, disponiveis), 'cenário ' + k + ': total de eleitos');
        const soma = r.P.reduce(function (a, x) { return a + x.vagas; }, 0);
        igual(soma, r.eleitos.length, 'cenário ' + k + ': soma das vagas dos partidos');
        const vistos = {};
        r.eleitos.concat(r.fila).forEach(function (e) {
          verdade(!vistos[e.c.n], 'cenário ' + k + ': candidato repetido ' + e.c.n);
          vistos[e.c.n] = true;
        });
        r.P.forEach(function (x) {
          const nossos = r.eleitos.filter(function (e) { return e.x === x; }).map(function (e) { return e.c.n; });
          igual(nossos, x.ordem.slice(0, nossos.length).map(function (c) { return c.n; }), 'cenário ' + k + ': eleitos de ' + x.p.id + ' são os mais votados do partido');
          verdade(x.vQP <= x.qp, 'cenário ' + k + ': vagas por quociente não passam do quociente partidário');
        });
      }
    });

    return T;
  }

  /** Casos reais agregados (dado público do TSE, só por partido). Vagas e fase têm de bater com o proclamado. */
  function testesReais(V, carregar) {
    const T = [];
    const nomes = ['camara_38_vagas', 'camara_9_vagas_5_na_3a_fase', 'deputado_federal_30_vagas'];
    nomes.forEach(function (nome) {
      T.push({
        nome: 'caso real "' + nome + '": QE, vagas por partido e vagas por quociente iguais ao TSE',
        fn: function () {
          return carregar('dados/' + nome + '.json').then(function (caso) {
            const ps = caso.partidos.map(function (p, i) {
              return {
                id: String(i), nome: p.nome, votos: p.votos,
                cands: p.candidatos.map(function (v, j) { return { n: i + '-' + j, nome: '', votos: v, valido: true, nasc: 0 }; })
              };
            });
            const r = V.distribuir(ps, caso.votosValidos, caso.vagas, 0);
            igual(r.qe, caso.qeTSE, nome + ': quociente eleitoral');
            let totalVagas = 0, totalTSE = 0;
            r.P.forEach(function (x, i) {
              const p = caso.partidos[i];
              igual(x.vagas, p.vagasTSE, nome + ': vagas de ' + p.nome);
              igual(x.vQP, p.eleitosQP, nome + ': eleitos pelo quociente em ' + p.nome);
              totalVagas += x.vagas; totalTSE += p.vagasTSE;
            });
            igual(totalVagas, caso.vagas, nome + ': todas as vagas distribuídas');
            igual(totalTSE, caso.vagas, nome + ': o TSE também distribuiu todas');
          });
        }
      });
    });
    return T;
  }

  /** Executa tudo e devolve [{nome, ok, erro}]. `carregar(caminho)` devolve uma Promise com o JSON. */
  async function rodar(V, carregar) {
    const todos = montarTestes(V).concat(carregar ? testesReais(V, carregar) : []);
    const saida = [];
    for (const teste of todos) {
      try { await teste.fn(); saida.push({ nome: teste.nome, ok: true }); }
      catch (e) { saida.push({ nome: teste.nome, ok: false, erro: e.message }); }
    }
    return saida;
  }

  raiz.rodarTestes = rodar;
  if (typeof module === 'object' && module.exports) { module.exports = { rodar: rodar }; }
})(typeof self !== 'undefined' ? self : this);
