#!/usr/bin/env python3
"""
Valida a conta de vagas contra as câmaras municipais do Paraná em 2024.

Para cada um dos 399 municípios, lê o arquivo público de resultados do TSE
(eleição municipal de 2024, vereador), refaz a distribuição de vagas com uma
implementação INDEPENDENTE da que roda no navegador (src/vagas.js) e compara
com o que o TSE proclamou:

  1. o quociente eleitoral;
  2. a lista de eleitos (por número de candidato);
  3. a fase de cada eleito (quociente partidário x sobras);
  4. as vagas de cada partido ou federação.

Uma câmara só conta como "igual ao TSE" se as quatro comparações fecham.

Uso:
    python validar_2024.py                      # baixa os 399 arquivos e imprime o resumo
    python validar_2024.py --saida resumo.json  # grava o resumo por município (sem nomes)
    python validar_2024.py --cache pasta/       # guarda os JSON baixados (fora do repositório)

Só biblioteca padrão. Nada de credencial: os arquivos são públicos.
"""
import argparse
import json
import os
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor

RAIZ = "https://resultados.tse.jus.br/oficial/ele2024/619/dados/pr/"
CABECALHOS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
                  "(KHTML, like Gecko) Chrome/126.0 Safari/537.36",
    "Accept": "application/json",
}


# ------------------------------------------------------------ a conta de vagas
def quociente_eleitoral(votos_validos, vagas):
    """Art. 106: votos válidos / vagas; fração até 0,5 desprezada, acima de 0,5 sobe."""
    q, resto = divmod(votos_validos, vagas)
    return q + 1 if 2 * resto > vagas else q


def distribuir(partidos, votos_validos, vagas):
    """
    partidos: lista de dicts {id, votos, cands: [(numero, votos, nasc), ...]} com os
    candidatos válidos já em ordem (mais votos primeiro; empate, o mais velho).
    Devolve (qe, eleitos, vagas_por_partido) com eleitos = [(numero, fase, id_partido)].
    """
    qe = quociente_eleitoral(votos_validos, vagas)
    estado = {p["id"]: {"p": p, "lug": 0} for p in partidos}
    eleitos = []

    def eleger(pid, fase, cand=None):
        e = estado[pid]
        c = cand or e["p"]["cands"][e["lug"]]
        e["lug"] += 1
        eleitos.append((c[0], fase, pid))

    # art. 111: nenhum partido chegou ao quociente
    if not any(p["votos"] >= qe for p in partidos):
        todos = [(c, p["id"]) for p in partidos for c in p["cands"]]
        todos.sort(key=lambda t: (-t[0][1], t[0][2]))
        for c, pid in todos[:vagas]:
            eleger(pid, "mais votados", c)
    else:
        # 1ª fase: quociente partidário; candidato com pelo menos 10% do QE
        for p in partidos:
            qp = p["votos"] // qe
            aptos = 0
            while aptos < len(p["cands"]) and 10 * p["cands"][aptos][1] >= qe:
                aptos += 1
            for _ in range(min(qp, aptos)):
                eleger(p["id"], "QP")

        def melhor(apto):
            """Maior média votos/(lugares+1); empate: partido com mais votos."""
            m = None
            for p in partidos:
                e = estado[p["id"]]
                if not apto(p, e):
                    continue
                if m is None:
                    m = p
                    continue
                em = estado[m["id"]]
                esq = p["votos"] * (em["lug"] + 1)
                dir_ = m["votos"] * (e["lug"] + 1)
                if esq > dir_ or (esq == dir_ and p["votos"] > m["votos"]):
                    m = p
            return m

        # 2ª fase: partido com 80% do QE e candidato com 20% do QE
        def apto_media(p, e):
            return (5 * p["votos"] >= 4 * qe and e["lug"] < len(p["cands"])
                    and 5 * p["cands"][e["lug"]][1] >= qe)

        while len(eleitos) < vagas:
            p = melhor(apto_media)
            if p is None:
                break
            eleger(p["id"], "média")

        # 3ª fase: abertas a todos (STF, ADIs 7228, 7263 e 7325)
        while len(eleitos) < vagas:
            p = melhor(lambda p, e: e["lug"] < len(p["cands"]))
            if p is None:
                break
            eleger(p["id"], "3ª fase")

    por_partido = {}
    for _, _, pid in eleitos:
        por_partido[pid] = por_partido.get(pid, 0) + 1
    return qe, eleitos, por_partido


# ------------------------------------------------------------- leitura do TSE
def baixar(cd, cache):
    nome = "pr%s-c0013-e000619-u.json" % cd
    if cache:
        caminho = os.path.join(cache, nome)
        if os.path.exists(caminho):
            with open(caminho, encoding="utf-8") as f:
                return json.load(f)
    for tentativa in range(4):
        try:
            req = urllib.request.Request(RAIZ + nome, headers=CABECALHOS)
            with urllib.request.urlopen(req, timeout=40) as r:
                bruto = r.read()
            d = json.loads(bruto.decode("utf-8"))
            if cache:
                os.makedirs(cache, exist_ok=True)
                with open(os.path.join(cache, nome), "wb") as f:
                    f.write(bruto)
            return d
        except Exception:
            if tentativa == 3:
                raise
            time.sleep(1.5 * (tentativa + 1))


def data_num(s):
    if s and len(s) >= 10 and s[2] == "/" and s[5] == "/":
        return int(s[6:10] + s[3:5] + s[0:2])
    return 99999999


def conferir(d):
    """Refaz a conta de um município e compara com o TSE. Devolve um resumo sem nomes."""
    cg = d["carg"][0]
    vagas = int(cg["nv"])
    vv = int(d["v"]["vv"])
    partidos, tse_eleitos, tse_vagas = [], {}, {}
    for a in cg["agr"]:
        votos, cands = 0, []
        for par in a.get("par", []):
            votos += int(par.get("tvtn") or 0) + int(par.get("tvtl") or 0)
            for c in par.get("cand", []):
                valido = (not c.get("dvt")) or c["dvt"] == "Válido"
                if valido:
                    cands.append((str(c["n"]), int(c.get("vap") or 0), data_num(c.get("dt"))))
                if c.get("e") == "s":
                    tse_eleitos[str(c["n"])] = "QP" if "QP" in (c.get("st") or "") else "sobra"
        cands.sort(key=lambda t: (-t[1], t[2]))
        partidos.append({"id": str(a["n"]), "votos": votos, "cands": cands})
        tse_vagas[str(a["n"])] = int(a.get("vag") or 0)

    qe, eleitos, por_partido = distribuir(partidos, vv, vagas)
    problemas = 0
    if qe != int(cg["qe"]):
        problemas += 1
    nossos = {n: ("QP" if fase == "QP" else "sobra") for n, fase, _ in eleitos}
    if set(nossos) != set(tse_eleitos):
        problemas += len(set(nossos) ^ set(tse_eleitos))
    problemas += sum(1 for n in set(nossos) & set(tse_eleitos) if nossos[n] != tse_eleitos[n])
    for pid, v in tse_vagas.items():
        if por_partido.get(pid, 0) != v:
            problemas += 1
    return {
        "vagas": vagas,
        "cadeiras": len(eleitos),
        "terceira_fase": sum(1 for _, f, _ in eleitos if f == "3ª fase"),
        "igual": problemas == 0,
        "diferencas": problemas,
    }


def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--municipios", default=os.path.join(os.path.dirname(os.path.abspath(__file__)), "municipios_pr.json"))
    ap.add_argument("--saida", help="grava o resumo por município neste arquivo JSON")
    ap.add_argument("--cache", help="pasta onde guardar os arquivos baixados")
    ap.add_argument("--paralelo", type=int, default=8)
    args = ap.parse_args()

    with open(args.municipios, encoding="utf-8") as f:
        lista = [m["tse"] for m in json.load(f)["municipios"]]

    def um(cd):
        try:
            return cd, conferir(baixar(cd, args.cache)), None
        except Exception as e:  # noqa: BLE001
            return cd, None, str(e)

    with ThreadPoolExecutor(max_workers=args.paralelo) as ex:
        resultados = list(ex.map(um, lista))

    ok = [(cd, r) for cd, r, e in resultados if r]
    erros = [(cd, e) for cd, r, e in resultados if not r]
    iguais = sum(1 for _, r in ok if r["igual"])
    resumo = {
        "eleicao": "Câmaras municipais do Paraná, 2024 (vereador)",
        "municipios_lidos": len(ok),
        "municipios_nao_lidos": len(erros),
        "camaras_iguais_ao_tse": iguais,
        "camaras_com_diferenca": len(ok) - iguais,
        "cadeiras": sum(r["cadeiras"] for _, r in ok),
        "cadeiras_na_terceira_fase": sum(r["terceira_fase"] for _, r in ok),
        "municipios": {cd: r for cd, r in ok},
    }
    print("municípios lidos:        %d de %d" % (len(ok), len(lista)))
    print("câmaras iguais ao TSE:   %d" % iguais)
    print("câmaras com diferença:   %d" % (len(ok) - iguais))
    print("cadeiras:                %d" % resumo["cadeiras"])
    print("  na 3ª fase:            %d" % resumo["cadeiras_na_terceira_fase"])
    for cd, e in erros[:10]:
        print("não lido %s: %s" % (cd, e))
    for cd, r in ok:
        if not r["igual"]:
            print("diferença em %s: %d" % (cd, r["diferencas"]))
    if args.saida:
        with open(args.saida, "w", encoding="utf-8") as f:
            json.dump(resumo, f, ensure_ascii=False, indent=1)
    return 0 if iguais == len(lista) else 1


if __name__ == "__main__":
    sys.exit(main())
