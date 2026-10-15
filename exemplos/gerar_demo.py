#!/usr/bin/env python3
"""
Gera os arquivos sintéticos do modo demonstração (?demo=1).

Cria 4 "totalizações" de uma eleição proporcional fictícia (estado Meridiano,
12 vagas de deputado federal) no MESMO formato dos arquivos do TSE, para a
página funcionar mesmo quando o TSE não está divulgando nada. A cada leitura a
página avança uma totalização: 18%, 46%, 78% e 100% das seções.

Tudo é inventado: partidos, candidatos, datas e votos. A semente é fixa, então
rodar de novo reproduz os mesmos arquivos.

Uso:  python gerar_demo.py
"""
import json
import os
import random
import sys

AQUI = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(AQUI, "..", "validacao"))
from validar_2024 import distribuir  # noqa: E402  (a mesma conta, em Python)

VAGAS = 12
TOTAL_VALIDOS = 1_200_000
SECOES = 8_400
FRACOES = [0.18, 0.46, 0.78, 1.0]

# id, nome, tipo, siglas, número, fatia dos votos válidos, viés das primeiras urnas
PARTIDOS = [
    ("90", "Federação Frente Cívica", "f", [("PCV", "Partido Cívico", "91"), ("PSM", "Partido Social Meridiano", "92")], 0.19, -0.05),
    ("93", "Partido Horizonte", "i", [("PHZ", "Partido Horizonte", "93")], 0.22, 0.15),
    ("94", "Partido do Litoral", "i", [("PDL", "Partido do Litoral", "94")], 0.17, 0.05),
    ("95", "Aliança Cidadã", "i", [("ACI", "Aliança Cidadã", "95")], 0.14, -0.10),
    ("96", "Movimento Renova", "i", [("MRN", "Movimento Renova", "96")], 0.11, 0.00),
    ("97", "União Meridiana", "i", [("UMD", "União Meridiana", "97")], 0.09, -0.08),
    ("98", "Partido Trabalho e Terra", "i", [("PTT", "Partido Trabalho e Terra", "98")], 0.05, 0.10),
    ("99", "Partido Novo Rumo", "i", [("PNR", "Partido Novo Rumo", "99")], 0.03, 0.00),
]
FOCO = ("9101", "HELENA CORVELO")  # candidata fictícia, na federação


def quociente(vv, vagas):
    q, r = divmod(vv, vagas)
    return q + 1 if 2 * r > vagas else q


def montar_finais(rng):
    """Votos finais por candidato: 6% do partido vai para a legenda, o resto é nominal (curva em cauda)."""
    partidos = []
    for pid, nome, tipo, siglas, fatia, vies in PARTIDOS:
        total = int(TOTAL_VALIDOS * fatia)
        legenda = int(total * 0.06)
        nominal = total - legenda
        nc = 18 if fatia > 0.1 else 12
        pesos = [1.0 / (i + 1) ** 1.15 * rng.uniform(0.85, 1.15) for i in range(nc)]
        pesos.sort(reverse=True)
        soma = sum(pesos)
        votos = [int(nominal * p / soma) for p in pesos]
        cands = []
        for i, v in enumerate(votos):
            sg, _, numpar = siglas[i % len(siglas)]
            n = numpar + "%02d" % (i + 1)
            nmu = "CANDIDATO %s" % n
            dvt = "Válido"
            if pid == "90" and i == 0:
                n, nmu = FOCO
            if pid == "95" and i == 2:
                dvt = "Anulado sub judice"  # voto fora da conta, como no arquivo real
            nasc = "%02d/%02d/%d" % (rng.randint(1, 28), rng.randint(1, 12), rng.randint(1958, 1996))
            cands.append({"n": n, "nmu": nmu, "sg": sg, "dt": nasc, "dvt": dvt, "vap": v})
        partidos.append({"id": pid, "nome": nome, "tipo": tipo, "siglas": siglas, "legenda": legenda, "cands": cands, "vies": vies})
    return partidos


def snapshot(finais, anterior, frac, idx, rng, ultimo):
    agr, validos_partido = [], {}
    for p in finais:
        escala = frac * (1 + p["vies"] * (1 - frac))
        cands = []
        for c in p["cands"]:
            v = int(c["vap"] * escala * rng.uniform(0.97, 1.03)) if not ultimo else c["vap"]
            v = max(v, anterior.get(c["n"], 0))
            anterior[c["n"]] = v
            cands.append(dict(c, vap=v))
        leg = int(p["legenda"] * frac) if not ultimo else p["legenda"]
        agr.append((p, cands, leg))
    # votos do partido = nominais válidos + legenda (candidato anulado fica fora)
    vv = 0
    for p, cands, leg in agr:
        vv += sum(c["vap"] for c in cands if c["dvt"] == "Válido") + leg
    qe = quociente(vv, VAGAS)

    # vagas e situação só aparecem no fim, como no arquivo real
    vag, sit = {}, {}
    if ultimo:
        partidos = []
        for p, cands, leg in agr:
            validos = [c for c in cands if c["dvt"] == "Válido"]
            tuplas = sorted(((c["n"], c["vap"], int(c["dt"][6:] + c["dt"][3:5] + c["dt"][:2])) for c in validos),
                            key=lambda t: (-t[1], t[2]))
            partidos.append({"id": p["id"], "votos": sum(c["vap"] for c in validos) + leg, "cands": tuplas})
        _, eleitos, por = distribuir(partidos, vv, VAGAS)
        vag = por
        for n, fase, _ in eleitos:
            sit[n] = "Eleito por QP" if fase == "QP" else "Eleito por média"
    sai = []
    for p, cands, leg in agr:
        par = {}
        for sg, nm, num in p["siglas"]:
            par[sg] = {"n": num, "sg": sg, "nm": nm, "nfed": "", "dvt": "Válido (legenda)", "tvtn": 0, "tvtl": 0, "cand": []}
        for c in cands:
            par[c["sg"]]["cand"].append({
                "n": c["n"], "nm": c["nmu"], "nmu": c["nmu"], "dt": c["dt"], "dvt": c["dvt"],
                "e": "s" if c["n"] in sit else "n",
                "st": sit.get(c["n"], ("Suplente" if ultimo else "")) if c["dvt"] == "Válido" else "Indeferido",
                "vap": str(c["vap"]),
                "pvapn": "%.9f" % (100.0 * c["vap"] / vv if vv else 0),
            })
            if c["dvt"] == "Válido":
                par[c["sg"]]["tvtn"] += c["vap"]
        primeiro = next(iter(par.values()))
        primeiro["tvtl"] = leg
        for x in par.values():
            x["tvtn"], x["tvtl"] = str(x["tvtn"]), str(x["tvtl"])
        a = {"n": p["id"], "nm": p["nome"], "tp": p["tipo"], "com": "/".join(s[0] for s in p["siglas"]) if p["tipo"] == "f" else p["siglas"][0][0],
             "vag": str(vag.get(p["id"], 0)), "par": list(par.values())}
        sai.append(a)
    st = int(SECOES * frac)
    return {
        "ele": "0", "t": "1", "f": "o", "tpabr": "uf", "cdabr": "me",
        "dg": "04/10/2026", "hg": "%02d:%02d:00" % (17 + idx // 2, 20 + 25 * (idx % 2)), "idg": str(1000 + idx),
        "and": "f" if ultimo else "n",
        "carg": [{"cd": "6", "nmn": "Deputado Federal (exemplo)", "nv": str(VAGAS), "qe": str(qe), "agr": sai}],
        "s": {"ts": str(SECOES), "st": str(st), "pst": ("%.2f" % (100 * st / SECOES)).replace(".", ","), "pstn": "%.2f" % (100 * st / SECOES)},
        "v": {"vv": str(vv)},
    }


def main():
    rng = random.Random(2026)
    finais = montar_finais(rng)
    anterior = {}
    for i, frac in enumerate(FRACOES):
        d = snapshot(finais, anterior, frac, i, rng, i == len(FRACOES) - 1)
        caminho = os.path.join(AQUI, "demo-%d.json" % (i + 1))
        with open(caminho, "w", encoding="utf-8") as f:
            json.dump(d, f, ensure_ascii=False, indent=1)
        print(os.path.basename(caminho), d["s"]["pst"] + "%", "vv", d["v"]["vv"], "qe", d["carg"][0]["qe"])


if __name__ == "__main__":
    main()
