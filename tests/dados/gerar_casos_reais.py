#!/usr/bin/env python3
"""
Gera os casos reais agregados usados em tests/tests.html.

Lê resultados públicos do TSE e guarda, por partido ou federação, só números:
votos do partido, votos de cada candidato válido (sem nome nem número) e as
vagas que o TSE proclamou. Nenhuma pessoa é identificada.

Uso:  python gerar_casos_reais.py
"""
import json
import os
import urllib.request

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = "https://resultados.tse.jus.br/oficial/"
CAB = {"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36",
       "Accept": "application/json"}

CASOS = [
    ("camara_38_vagas", "ele2024/619/dados/pr/pr75353-c0013-e000619-u.json",
     "Câmara municipal de grande porte (38 vagas), 2024, resultado final"),
    ("camara_9_vagas_5_na_3a_fase", "ele2024/619/dados/pr/pr75213-c0013-e000619-u.json",
     "Câmara municipal pequena (9 vagas), 2024: cinco das nove vagas saem na 3ª fase"),
    ("deputado_federal_30_vagas", "ele2026/6259/dados/pr/pr-c0006-e006259-u.json",
     "Deputado federal, estado com 30 vagas e federações, 2026, resultado final"),
]


def baixar(caminho):
    req = urllib.request.Request(RAIZ + caminho, headers=CAB)
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read().decode("utf-8"))


def agregar(d, descricao, caminho):
    cg = d["carg"][0]
    partidos = []
    for a in cg["agr"]:
        votos, cands, qp = 0, [], 0
        for p in a.get("par", []):
            votos += int(p.get("tvtn") or 0) + int(p.get("tvtl") or 0)
            for c in p.get("cand", []):
                if (not c.get("dvt")) or c["dvt"] == "Válido":
                    cands.append((int(c.get("vap") or 0), c.get("dt") or ""))
                if c.get("e") == "s" and "QP" in (c.get("st") or ""):
                    qp += 1
        # mesma ordem da conta: mais votos primeiro; empate, o mais velho
        cands.sort(key=lambda t: (-t[0], t[1][6:10] + t[1][3:5] + t[1][0:2] if t[1] else "99999999"))
        nome = str(a.get("com") or a["nm"])
        if a.get("tp") == "f":
            nome = "Federação " + nome.replace(" / ", "/")
        partidos.append({"nome": nome, "votos": votos, "candidatos": [v for v, _ in cands],
                         "vagasTSE": int(a.get("vag") or 0), "eleitosQP": qp})
    return {"descricao": descricao, "fonte": RAIZ + caminho, "vagas": int(cg["nv"]),
            "votosValidos": int(d["v"]["vv"]), "qeTSE": int(cg["qe"]), "partidos": partidos}


def main():
    for nome, caminho, descricao in CASOS:
        caso = agregar(baixar(caminho), descricao, caminho)
        saida = os.path.join(AQUI, nome + ".json")
        with open(saida, "w", encoding="utf-8") as f:
            json.dump(caso, f, ensure_ascii=False, separators=(",", ":"))
        print(nome, caso["vagas"], "vagas,", len(caso["partidos"]), "partidos")


if __name__ == "__main__":
    main()
