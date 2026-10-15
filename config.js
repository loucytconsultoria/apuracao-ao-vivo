/* Configuração da página. Tudo aqui pode ser sobrescrito por parâmetros na URL:
   ?ano=2026&eleicao=6259&uf=pr&cargo=6&numero=NNNN&partido=SIGLA
   ?mun=75353&ano=2024&eleicao=619&cargo=13       (eleição municipal)
   ?demo=1                                          (dados sintéticos)
*/
window.APURACAO_CONFIG = {
  /* Intervalo entre leituras do TSE, em segundos. */
  intervaloSegundos: 30,

  /* Eleição aberta por padrão (a lista "eleicoes" abaixo alimenta o seletor). */
  padrao: { ano: 2026, eleicao: 6259, uf: 'pr', cargo: 6, mun: '' },

  /* Candidato e federação/partido em foco. Vazio = nenhum em foco:
     a página mostra o quadro geral. Preencha para destacar alguém:
       numero   número de urna do candidato (ex.: 'NNNN', 4 dígitos)
       partido  número, sigla ou nome da federação/partido (ex.: a sigla, como 'PL', ou parte do nome da federação) */
  foco: { numero: '', partido: '' },

  /* Eleições do seletor. "mun" é o código do município no TSE (eleições municipais). */
  eleicoes: [
    { rotulo: 'Deputado federal · PR 2026', ano: 2026, eleicao: 6259, uf: 'pr', cargo: 6, mun: '' },
    { rotulo: 'Deputado estadual · PR 2026', ano: 2026, eleicao: 6259, uf: 'pr', cargo: 7, mun: '' },
    { rotulo: 'Vereador · Curitiba 2024', ano: 2024, eleicao: 619, uf: 'pr', cargo: 13, mun: '75353' },
    { rotulo: 'Vereador · Londrina 2024', ano: 2024, eleicao: 619, uf: 'pr', cargo: 13, mun: '76678' }
  ],

  /* Modo demonstração (?demo=1): quatro totalizações sintéticas de um estado
     fictício, no mesmo formato do TSE. A cada leitura a página avança uma. */
  demo: {
    arquivos: ['exemplos/demo-1.json', 'exemplos/demo-2.json', 'exemplos/demo-3.json', 'exemplos/demo-4.json'],
    intervaloSegundos: 5,
    rotulo: 'Deputado federal · Meridiano (exemplo)',
    numero: '9101',
    partido: ''
  }
};
