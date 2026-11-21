"""
Minimal local dev server — the server-side hop for "the browser never
talks to the bond store directly" (see bonds.py).
It holds the Supabase service-role key, reads/writes public.rpos, and
hands the UI back plain JSON.

Dev-only. Not deployed anywhere; run it alongside the Vite dev server:

    python3 api/server.py

Endpoints:
  GET  /bonds?type=natcat  -> list_bonds(type), extracted to a plain array.
  GET  /bonds/<deal_id>    -> get_bond(deal_id), extracted to the bare bond
                               record. What DealPage.jsx calls to show a
                               posted deal's description — it reads dealId
                               straight off the deployed CatBond (a public
                               getter) and looks the record up from there,
                               no localStorage/param plumbing needed.
  POST /bonds              -> create_bond(), the "Build a bond" workshop's
                               web2 half of Post deal. Body: {cedant,
                               description, maturity, value, triggerAddress?,
                               productId?, productVersion?}. Returns
                               {"dealId": "..."}. Mirrors deploy_deal.py's
                               step 1 (create draft record -> dealId), just
                               reached from the browser instead of a script.
  POST /bonds/link         -> link_contract_address(), step 3 of the same
                               handshake — attach the now-deployed contract
                               address back onto the bond record. Body:
                               {dealId, contractAddress, triggerAddress?,
                               productId?, productVersion?}.

CORS is wide open (Access-Control-Allow-Origin: *) because this never
runs anywhere but localhost during development — tighten this before any
real deployment, the same "replace before launch" caveat as
CANONICAL_TRIGGERS/RHODEX_COMPANY_WALLET in the UI.
"""

import requests
from flask import Flask, jsonify, request

import bonds

app = Flask(__name__)


@app.after_request
def _allow_cors(response):
    response.headers["Access-Control-Allow-Origin"] = "*"
    response.headers["Access-Control-Allow-Methods"] = "GET, POST, OPTIONS"
    response.headers["Access-Control-Allow-Headers"] = "Content-Type"
    return response


@app.errorhandler(EnvironmentError)
def _missing_config(e):
    return jsonify({"error": str(e)}), 500


@app.errorhandler(requests.HTTPError)
def _store_error(e):
    return jsonify({"error": str(e)}), 502


@app.get("/bonds")
def get_bonds():
    try:
        return jsonify(bonds.list_bonds(
            request.args.get("type", bonds.DEFAULT_TRIGGER_TYPE),
            environment=request.args.get("environment") or None,
            network=request.args.get("network") or None,
        ))
    except ValueError as e:
        return jsonify({"error": str(e)}), 400


@app.get("/bonds/<deal_id>")
def get_bond_by_id(deal_id):
    if not deal_id.isdigit():
        # Deals posted before the Supabase move (2026-11-17) carry a
        # non-numeric id on-chain; there's no record for them.
        return jsonify({"error": "bond not found"}), 404
    try:
        return jsonify(bonds.get_bond(deal_id))
    except bonds.BondNotFound:
        return jsonify({"error": "bond not found"}), 404


@app.post("/bonds")
def create_bond():
    body = request.get_json(force=True, silent=True) or {}
    try:
        payload = bonds.build_bond_payload(
            cedant=body.get("cedant", ""),
            description=body.get("description", ""),
            maturity=body.get("maturity", ""),
            value=body.get("value", 0),
            trigger_address=body.get("triggerAddress", ""),
            product_id=body.get("productId", ""),
            product_version=body.get("productVersion"),
            network=body.get("network", ""),
            environment=body.get("environment", ""),
        )
        row = bonds.create_bond(payload)
    except ValueError as e:
        return jsonify({"error": str(e)}), 400
    # CatBond.dealId is a string on-chain.
    return jsonify({"dealId": str(row["id"])})


@app.post("/bonds/link")
def link_bond():
    body = request.get_json(force=True, silent=True) or {}
    deal_id = str(body.get("dealId") or "")
    contract_address = body.get("contractAddress")
    if not deal_id.isdigit() or not contract_address:
        return jsonify({"error": "numeric dealId and contractAddress are required"}), 400
    try:
        row = bonds.link_contract_address(
            deal_id, contract_address,
            trigger_address=body.get("triggerAddress"),
            product_id=body.get("productId"),
            product_version=body.get("productVersion"),
            network=body.get("network"),
        )
    except bonds.BondNotFound:
        return jsonify({"error": "bond not found"}), 404
    return jsonify({"ok": True, "bond": row})


if __name__ == "__main__":
    app.run(port=5001, debug=True)
